#include <node_api.h>
#include <stdint.h>
#include <string>

#ifdef _WIN32
#include <windows.h>
#include <sddl.h>
#else
#include <errno.h>
#include <fcntl.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/statfs.h>
#include <unistd.h>
#endif

struct LockHandle {
#ifdef _WIN32
  HANDLE value;
#else
  int value;
#endif
  bool released;
};

static void Throw(napi_env env, const char* code, const char* message) {
  napi_value error, text, code_value;
  napi_create_string_utf8(env, message, NAPI_AUTO_LENGTH, &text);
  napi_create_error(env, nullptr, text, &error);
  napi_create_string_utf8(env, code, NAPI_AUTO_LENGTH, &code_value);
  napi_set_named_property(env, error, "code", code_value);
  napi_throw(env, error);
}

static bool GetString(napi_env env, napi_value value, std::string* output) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) return false;
  output->resize(length + 1);
  bool ok = napi_get_value_string_utf8(env, value, output->data(), length + 1, &length) == napi_ok;
  output->resize(length);
  return ok;
}

#ifdef _WIN32
static std::wstring Utf8ToWide(const std::string& input) {
  int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, input.data(), (int)input.size(), nullptr, 0);
  if (length <= 0) return L"";
  std::wstring output(length, L'\0');
  MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, input.data(), (int)input.size(), output.data(), length);
  return output;
}

static std::string WideToUtf8(const std::wstring& input) {
  int length = WideCharToMultiByte(CP_UTF8, 0, input.data(), (int)input.size(), nullptr, 0, nullptr, nullptr);
  std::string output(length, '\0');
  WideCharToMultiByte(CP_UTF8, 0, input.data(), (int)input.size(), output.data(), length, nullptr, nullptr);
  return output;
}
#endif

static void Finalize(napi_env env, void* data, void*) {
  LockHandle* handle = static_cast<LockHandle*>(data);
  if (!handle->released) {
#ifdef _WIN32
    ReleaseMutex(handle->value);
    CloseHandle(handle->value);
#else
    flock(handle->value, LOCK_UN);
    close(handle->value);
#endif
  }
  delete handle;
}

static napi_value GetVolumeId(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  std::string input;
  if (argc != 1 || !GetString(env, args[0], &input)) {
    Throw(env, "EINVAL", "path must be a string");
    return nullptr;
  }
  std::string result;
#ifdef _WIN32
  std::wstring path = Utf8ToWide(input);
  wchar_t volume_path[MAX_PATH + 1] = {0};
  wchar_t volume_name[MAX_PATH + 1] = {0};
  DWORD serial = 0;
  while (!path.empty() && !GetVolumePathNameW(path.c_str(), volume_path, MAX_PATH)) {
    size_t slash = path.find_last_of(L"\\/");
    if (slash == std::wstring::npos) break;
    path = slash <= 2 ? path.substr(0, slash + 1) : path.substr(0, slash);
  }
  if (path.empty() || !volume_path[0] ||
      !GetVolumeNameForVolumeMountPointW(volume_path, volume_name, MAX_PATH) ||
      !GetVolumeInformationW(volume_path, nullptr, 0, &serial, nullptr, nullptr, nullptr, 0)) {
    Throw(env, "EVOLUME", "unable to resolve stable Windows volume identity");
    return nullptr;
  }
  result = WideToUtf8(volume_name) + ":" + std::to_string(serial);
#else
  struct stat stat_value;
  std::string cursor = input;
  while (stat(cursor.c_str(), &stat_value) != 0 && errno == ENOENT) {
    size_t slash = cursor.find_last_of('/');
    if (slash == std::string::npos) break;
    cursor = slash == 0 ? "/" : cursor.substr(0, slash);
  }
  if (stat(cursor.c_str(), &stat_value) != 0) {
    Throw(env, "EVOLUME", "unable to resolve stable POSIX volume identity");
    return nullptr;
  }
  result = std::to_string((uint64_t)stat_value.st_dev);
#endif
  napi_value output;
  napi_create_string_utf8(env, result.c_str(), result.size(), &output);
  return output;
}

static napi_value IsRemote(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1], output;
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  std::string input;
  bool remote = false;
  if (argc != 1 || !GetString(env, args[0], &input)) {
    Throw(env, "EINVAL", "path must be a string");
    return nullptr;
  }
#ifdef _WIN32
  std::wstring path = Utf8ToWide(input);
  wchar_t volume_path[MAX_PATH + 1] = {0};
  while (!path.empty() && !GetVolumePathNameW(path.c_str(), volume_path, MAX_PATH)) {
    size_t slash = path.find_last_of(L"\\/");
    if (slash == std::wstring::npos) break;
    path = slash <= 2 ? path.substr(0, slash + 1) : path.substr(0, slash);
  }
  if (path.empty() || !volume_path[0]) {
    Throw(env, "EVOLUME", "unable to inspect Windows volume");
    return nullptr;
  }
  remote = GetDriveTypeW(volume_path) == DRIVE_REMOTE;
#else
  struct statfs value;
  std::string cursor = input;
  while (statfs(cursor.c_str(), &value) != 0 && errno == ENOENT) {
    size_t slash = cursor.find_last_of('/');
    if (slash == std::string::npos) break;
    cursor = slash == 0 ? "/" : cursor.substr(0, slash);
  }
  if (statfs(cursor.c_str(), &value) != 0) {
    Throw(env, "EVOLUME", "unable to inspect POSIX filesystem");
    return nullptr;
  }
  remote = value.f_type == 0x6969 || value.f_type == 0x517B || value.f_type == 0xFF534D42;
#endif
  napi_get_boolean(env, remote, &output);
  return output;
}

static napi_value Acquire(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  std::string id;
  if (argc != 1 || !GetString(env, args[0], &id)) {
    Throw(env, "EINVAL", "volume hash must be a string");
    return nullptr;
  }
  LockHandle* handle = new LockHandle();
  handle->released = false;
#ifdef _WIN32
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  SECURITY_ATTRIBUTES attributes = { sizeof(SECURITY_ATTRIBUTES), nullptr, FALSE };
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(L"D:(A;;0x00100001;;;AU)(A;;GA;;;SY)(A;;GA;;;BA)", SDDL_REVISION_1, &descriptor, nullptr)) {
    delete handle;
    Throw(env, "EACL", "unable to create machine-wide mutex ACL");
    return nullptr;
  }
  attributes.lpSecurityDescriptor = descriptor;
  std::wstring name = L"Global\\LingganWorkbench.Volume.v2." + Utf8ToWide(id);
  handle->value = CreateMutexW(&attributes, FALSE, name.c_str());
  DWORD create_error = GetLastError();
  LocalFree(descriptor);
  if (!handle->value && create_error == ERROR_ACCESS_DENIED) {
    handle->value = OpenMutexW(SYNCHRONIZE | MUTEX_MODIFY_STATE, FALSE, name.c_str());
  }
  if (!handle->value) {
    delete handle;
    Throw(env, "EMUTEX", "unable to create machine-wide mutex");
    return nullptr;
  }
  DWORD wait = WaitForSingleObject(handle->value, 0);
  if (wait != WAIT_OBJECT_0 && wait != WAIT_ABANDONED) {
    CloseHandle(handle->value);
    delete handle;
    napi_value null_value;
    napi_get_null(env, &null_value);
    return null_value;
  }
#else
  struct stat temp_stat;
  if (lstat("/var/tmp", &temp_stat) != 0 || !S_ISDIR(temp_stat.st_mode) || S_ISLNK(temp_stat.st_mode) ||
      temp_stat.st_uid != 0 || (temp_stat.st_mode & 07777) != 01777) {
    delete handle;
    Throw(env, "EFLOCK", "/var/tmp must be root-owned mode 01777 and not a symlink");
    return nullptr;
  }
  std::string file = "/var/tmp/linggan-workbench-volume-v2-" + id + ".lock";
  handle->value = open(file.c_str(), O_CREAT | O_RDWR | O_NOFOLLOW | O_CLOEXEC, 0666);
  if (handle->value < 0) {
    if (handle->value >= 0) close(handle->value);
    delete handle;
    Throw(env, "EFLOCK", "unable to open audited volume lock file");
    return nullptr;
  }
  struct stat fd_stat, path_stat;
  if (fstat(handle->value, &fd_stat) != 0 ||
      (((fd_stat.st_mode & 0777) != 0666) && fchmod(handle->value, 0666) != 0) ||
      fstat(handle->value, &fd_stat) != 0 || lstat(file.c_str(), &path_stat) != 0 ||
      !S_ISREG(fd_stat.st_mode) || fd_stat.st_dev != path_stat.st_dev || fd_stat.st_ino != path_stat.st_ino) {
    close(handle->value);
    delete handle;
    Throw(env, "EFLOCK", "volume lock file identity mismatch");
    return nullptr;
  }
  if (flock(handle->value, LOCK_EX | LOCK_NB) != 0) {
    close(handle->value);
    delete handle;
    napi_value null_value;
    napi_get_null(env, &null_value);
    return null_value;
  }
#endif
  napi_value external;
  napi_create_external(env, handle, Finalize, nullptr, &external);
  return external;
}

static napi_value Release(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1], output;
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  LockHandle* handle = nullptr;
  if (argc != 1 || napi_get_value_external(env, args[0], reinterpret_cast<void**>(&handle)) != napi_ok || !handle) {
    Throw(env, "EINVAL", "invalid lock handle");
    return nullptr;
  }
  bool released = false;
  if (!handle->released) {
#ifdef _WIN32
    released = ReleaseMutex(handle->value) != 0;
    CloseHandle(handle->value);
#else
    released = flock(handle->value, LOCK_UN) == 0;
    close(handle->value);
#endif
    handle->released = true;
  }
  napi_get_boolean(env, released, &output);
  return output;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    {"getVolumeId", nullptr, GetVolumeId, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"isRemote", nullptr, IsRemote, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"acquire", nullptr, Acquire, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"release", nullptr, Release, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, 4, properties);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
