// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

package com.owaiskhan.converter.bridge

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * Registers ConverterCore's TurboModules with React Native.
 *
 * `BaseReactPackage` resolves modules lazily by name, so a module is constructed only
 * when JavaScript first reaches for it. That matters for cold start: the file gateway
 * needs the main queue, and building it eagerly would put a picker's worth of setup on
 * the launch path for a user who may never open one.
 */
public class ConverterCorePackage : BaseReactPackage() {

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    when (name) {
      NativeFormatDetectorModule.NAME -> NativeFormatDetectorModule(reactContext)
      NativeRasterCodecModule.NAME -> NativeRasterCodecModule(reactContext)
      NativeJobQueueModule.NAME -> NativeJobQueueModule(reactContext)
      NativePdfEngineModule.NAME -> NativePdfEngineModule(reactContext)
      NativeFileGatewayModule.NAME -> NativeFileGatewayModule(reactContext)
      else -> null
    }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
      NativeFormatDetectorModule.NAME to info(NativeFormatDetectorModule.NAME, needsEagerInit = false),
      NativeRasterCodecModule.NAME to info(NativeRasterCodecModule.NAME, needsEagerInit = false),
      NativeJobQueueModule.NAME to info(NativeJobQueueModule.NAME, needsEagerInit = false),
      NativePdfEngineModule.NAME to info(NativePdfEngineModule.NAME, needsEagerInit = false),
      // The gateway presents system pickers, so it is created on the main queue.
      NativeFileGatewayModule.NAME to info(NativeFileGatewayModule.NAME, needsEagerInit = true),
    )
  }

  private fun info(name: String, needsEagerInit: Boolean) = ReactModuleInfo(
    /* name = */ name,
    /* className = */ name,
    /* canOverrideExistingModule = */ false,
    /* needsEagerInit = */ needsEagerInit,
    /* isCxxModule = */ false,
    /* isTurboModule = */ true,
  )
}
