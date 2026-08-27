{
  "targets": [
    {
      "target_name": "volume_lock",
      "sources": ["native/volume-lock/volume_lock.cc"],
      "defines": ["NAPI_VERSION=8"],
      "msvs_windows_target_platform_version": "10.0.22621.0",
      "conditions": [
        ["OS=='win'", {
          "libraries": ["Advapi32.lib"]
        }],
        ["OS!='win'", {
          "cflags_cc": ["-std=c++17"]
        }]
      ]
    }
  ]
}
