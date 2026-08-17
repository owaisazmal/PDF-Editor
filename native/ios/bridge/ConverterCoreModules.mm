// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

//
// TurboModule registration for ConverterCore.
//
// React Native's codegen emits Objective-C protocols, and conforming to them requires
// returning a C++ type from `getTurboModule:` — something Swift cannot express. So this
// file exists, and it does nothing except forward: every method hands straight to
// `ConverterCoreBridge`, which is Swift. Keeping it free of logic is deliberate, because
// this is the one layer with no tests behind it.
//

#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <ReactCommon/RCTTurboModule.h>

#import "ConverterCoreSpec/ConverterCoreSpec.h"

// Hand-written declaration rather than the generated `Converter-Swift.h` — see the
// note at the top of that header for why.
#import "ConverterCoreBridge.h"

#pragma mark - NativeFormatDetector

@interface NativeFormatDetector : NSObject <NativeFormatDetectorSpec>
@end

@implementation NativeFormatDetector

RCT_EXPORT_MODULE()

// Nothing here touches UIKit, so there is no reason to block app start on it.
+ (BOOL)requiresMainQueueSetup { return NO; }

- (void)detect:(NSString *)uri
       resolve:(RCTPromiseResolveBlock)resolve
        reject:(RCTPromiseRejectBlock)reject
{
  [ConverterCoreBridge detect:uri resolve:resolve reject:reject];
}

- (void)detectMany:(NSArray *)uris
           resolve:(RCTPromiseResolveBlock)resolve
            reject:(RCTPromiseRejectBlock)reject
{
  [ConverterCoreBridge detectMany:uris resolve:resolve reject:reject];
}

- (void)detectBase64:(NSString *)base64
            filename:(NSString *)filename
             resolve:(RCTPromiseResolveBlock)resolve
              reject:(RCTPromiseRejectBlock)reject
{
  [ConverterCoreBridge detectBase64:base64 filename:filename resolve:resolve reject:reject];
}

- (void)supportedFormats:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject
{
  [ConverterCoreBridge supportedFormats:resolve reject:reject];
}

- (std::shared_ptr<facebook::react::TurboModule>)
    getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeFormatDetectorSpecJSI>(params);
}

@end

#pragma mark - NativeRasterCodec

@interface NativeRasterCodec : NSObject <NativeRasterCodecSpec>
@end

@implementation NativeRasterCodec

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup { return NO; }

- (void)convert:(NSString *)inputUri
      outputUri:(NSString *)outputUri
        options:(NSDictionary *)options
        resolve:(RCTPromiseResolveBlock)resolve
         reject:(RCTPromiseRejectBlock)reject
{
  [ConverterCoreBridge convert:inputUri
                     outputUri:outputUri
                       options:options
                       resolve:resolve
                        reject:reject];
}

- (void)estimateByteSize:(NSString *)inputUri
                 options:(NSDictionary *)options
                 resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject
{
  [ConverterCoreBridge estimateByteSize:inputUri options:options resolve:resolve reject:reject];
}

- (void)makePreview:(NSString *)inputUri
       maxPixelSize:(double)maxPixelSize
            resolve:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject
{
  [ConverterCoreBridge makePreview:inputUri
                      maxPixelSize:maxPixelSize
                           resolve:resolve
                            reject:reject];
}

- (void)cancelAll
{
  [ConverterCoreBridge cancelAll];
}

- (std::shared_ptr<facebook::react::TurboModule>)
    getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeRasterCodecSpecJSI>(params);
}

@end

#pragma mark - NativeFileGateway

@interface NativeFileGateway : NSObject <NativeFileGatewaySpec>
@end

@implementation NativeFileGateway

RCT_EXPORT_MODULE()

// Presents PHPickerViewController, so this one genuinely does need the main queue.
+ (BOOL)requiresMainQueueSetup { return YES; }

- (void)pickPhotos:(double)limit
           resolve:(RCTPromiseResolveBlock)resolve
            reject:(RCTPromiseRejectBlock)reject
{
  [ConverterCoreBridge pickPhotos:limit resolve:resolve reject:reject];
}

- (void)pickDocuments:(NSArray *)utisOrMimeTypes
        allowMultiple:(BOOL)allowMultiple
              resolve:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject
{
  [ConverterCoreBridge pickDocuments:utisOrMimeTypes
                       allowMultiple:allowMultiple
                             resolve:resolve
                              reject:reject];
}

- (void)ensureLocal:(NSString *)uri
            resolve:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject
{
  [ConverterCoreBridge ensureLocal:uri resolve:resolve reject:reject];
}

- (void)freeDiskSpace:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject
{
  [ConverterCoreBridge freeDiskSpace:resolve reject:reject];
}

- (void)saveToPhotos:(NSArray *)uris
             resolve:(RCTPromiseResolveBlock)resolve
              reject:(RCTPromiseRejectBlock)reject
{
  [ConverterCoreBridge saveToPhotos:uris resolve:resolve reject:reject];
}

- (void)saveToDownloads:(NSArray *)uris
                resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject
{
  [ConverterCoreBridge saveToDownloads:uris resolve:resolve reject:reject];
}

- (void)createZip:(NSArray *)uris
          zipName:(NSString *)zipName
          resolve:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject
{
  [ConverterCoreBridge createZip:uris zipName:zipName resolve:resolve reject:reject];
}

- (NSString *)sanitiseFilename:(NSString *)name
{
  return [ConverterCoreBridge sanitiseFilename:name];
}

- (void)resolveCollision:(NSString *)directory
                filename:(NSString *)filename
                 resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject
{
  [ConverterCoreBridge resolveCollision:directory
                               filename:filename
                                resolve:resolve
                                 reject:reject];
}

- (void)clearTemporaryFiles:(RCTPromiseResolveBlock)resolve
                     reject:(RCTPromiseRejectBlock)reject
{
  [ConverterCoreBridge clearTemporaryFiles:resolve reject:reject];
}

- (std::shared_ptr<facebook::react::TurboModule>)
    getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeFileGatewaySpecJSI>(params);
}

@end
