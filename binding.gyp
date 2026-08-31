{
  "targets": [
    {
      "target_name": "volume_lock",
      "sources": ["native/volume-lock/volume_lock.cc"],
      "defines": ["NAPI_VERSION=8"],
      "conditions": [
        ["OS=='win'", {
          "msvs_windows_target_platform_version": "<!(node scripts/detect-windows-sdk.js)",
          "libraries": ["Advapi32.lib"]
        }],
        ["OS!='win'", {
          "cflags_cc": ["-std=c++17"]
        }]
      ]
    }
  ]
}
