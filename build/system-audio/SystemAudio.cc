// Direct access to the current macOS output device; no child process per slider input.
#include <CoreAudio/CoreAudio.h>
#include <AudioToolbox/AudioHardwareService.h>
#include <node_api.h>
#include <algorithm>
#include <cmath>

static bool output(napi_env env, AudioObjectID &device, AudioObjectPropertyAddress &volume) {
  AudioObjectPropertyAddress address = {
    kAudioHardwarePropertyDefaultOutputDevice, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain
  };
  UInt32 size = sizeof(device);
  if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, nullptr, &size, &device) != noErr
      || device == kAudioObjectUnknown) {
    napi_throw_error(env, nullptr, "SYSTEM_AUDIO_NO_OUTPUT");
    return false;
  }
  // The virtual main control preserves relative channel balance on devices
  // whose hardware exposes only individual volume controls.
  const AudioObjectPropertySelector selectors[] = {
    kAudioHardwareServiceDeviceProperty_VirtualMainVolume, kAudioDevicePropertyVolumeScalar
  };
  for (AudioObjectPropertySelector selector : selectors) {
    volume = {selector, kAudioObjectPropertyScopeOutput, kAudioObjectPropertyElementMain};
    if (AudioObjectHasProperty(device, &volume)) return true;
  }
  napi_throw_error(env, nullptr, "SYSTEM_AUDIO_NO_VOLUME");
  return false;
}

static napi_value getVolume(napi_env env, napi_callback_info info) {
  AudioObjectID device;
  AudioObjectPropertyAddress address;
  if (!output(env, device, address)) return nullptr;
  Float32 scalar = 0;
  UInt32 size = sizeof(scalar);
  if (AudioObjectGetPropertyData(device, &address, 0, nullptr, &size, &scalar) != noErr || !std::isfinite(scalar)) {
    napi_throw_error(env, nullptr, "SYSTEM_AUDIO_READ");
    return nullptr;
  }
  napi_value result;
  napi_create_int32(env, static_cast<int>(std::round(std::clamp(scalar, 0.0f, 1.0f) * 100)), &result);
  return result;
}

static napi_value setVolume(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argument;
  double requested = 0;
  napi_get_cb_info(env, info, &argc, &argument, nullptr, nullptr);
  if (argc != 1 || napi_get_value_double(env, argument, &requested) != napi_ok || !std::isfinite(requested)) {
    napi_throw_type_error(env, nullptr, "Expected a finite system volume.");
    return nullptr;
  }
  AudioObjectID device;
  AudioObjectPropertyAddress address;
  if (!output(env, device, address)) return nullptr;
  Boolean settable = false;
  Float32 scalar = static_cast<Float32>(std::clamp(requested, 0.0, 100.0) / 100.0);
  if (AudioObjectIsPropertySettable(device, &address, &settable) != noErr || !settable
      || AudioObjectSetPropertyData(device, &address, 0, nullptr, sizeof(scalar), &scalar) != noErr) {
    napi_throw_error(env, nullptr, "SYSTEM_AUDIO_WRITE");
    return nullptr;
  }
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value initialize(napi_env env, napi_value exports) {
  napi_property_descriptor methods[] = {
    {"getVolume", nullptr, getVolume, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setVolume", nullptr, setVolume, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, 2, methods);
  return exports;
}
NAPI_MODULE(nodus_system_audio, initialize)
