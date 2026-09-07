// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

//
// Objective-C declaration of the Swift bridge class.
//
// The obvious thing to do here is `#import "Converter-Swift.h"`, and it does not work:
// that generated header declares every `@objc` class in the app target, including the
// `AppDelegate`, whose superclass `ExpoAppDelegate` lives in a Swift module. Importing
// it from Objective-C++ therefore fails to find an interface it never needed to see.
//
// Declaring only what this file actually uses avoids that entirely, and keeps the
// TurboModule shim independent of whatever else the app target's Swift happens to
// contain.
//
// The one obligation this creates: every selector below must match the Swift side
// exactly. That is why `ConverterCoreBridge.swift` spells each one out with an explicit
// `@objc(name:with:args:)` rather than relying on Swift's inference — both halves are
// then written down and can be compared by reading them.
//

#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>

NS_ASSUME_NONNULL_BEGIN

@interface ConverterCoreBridge : NSObject

#pragma mark - Format detection

+ (void)detect:(NSString *)uri
       resolve:(RCTPromiseResolveBlock)resolve
        reject:(RCTPromiseRejectBlock)reject;

+ (void)detectMany:(NSArray<NSString *> *)uris
           resolve:(RCTPromiseResolveBlock)resolve
            reject:(RCTPromiseRejectBlock)reject;

+ (void)detectBase64:(NSString *)base64
            filename:(NSString *)filename
             resolve:(RCTPromiseResolveBlock)resolve
              reject:(RCTPromiseRejectBlock)reject;

+ (void)supportedFormats:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject;

#pragma mark - Raster codec

+ (void)convert:(NSString *)inputUri
      outputUri:(NSString *)outputUri
        options:(NSDictionary *)options
        resolve:(RCTPromiseResolveBlock)resolve
         reject:(RCTPromiseRejectBlock)reject;

+ (void)estimateByteSize:(NSString *)inputUri
                 options:(NSDictionary *)options
                 resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject;

+ (void)makePreview:(NSString *)inputUri
       maxPixelSize:(double)maxPixelSize
            resolve:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject;

#pragma mark - Job queue

+ (void)installJobQueueHandlersWithProgress:(void (^)(NSDictionary *))progress
                               fileComplete:(void (^)(NSDictionary *))fileComplete
                                 fileFailed:(void (^)(NSDictionary *))fileFailed
                                jobComplete:(void (^)(NSDictionary *))jobComplete;

+ (void)submitJob:(NSDictionary *)spec
          resolve:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject;

+ (void)cancelJob:(NSString *)jobId
          resolve:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject;

+ (void)jobState:(NSString *)jobId
         resolve:(RCTPromiseResolveBlock)resolve
          reject:(RCTPromiseRejectBlock)reject;

+ (void)retryFailed:(NSString *)jobId
            resolve:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject;

+ (void)releaseJob:(NSString *)jobId;

#pragma mark - PDF engine

+ (void)inspectPdf:(NSString *)uri
           resolve:(RCTPromiseResolveBlock)resolve
            reject:(RCTPromiseRejectBlock)reject;

+ (void)unlockPdf:(NSString *)uri
         password:(NSString *)password
          resolve:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject;

+ (void)renderPdfPages:(NSString *)uri
         sessionHandle:(NSString *)sessionHandle
               options:(NSDictionary *)options
               resolve:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject;

+ (void)composePdfFromImages:(NSArray *)imageUris
                   outputUri:(NSString *)outputUri
                     options:(NSDictionary *)options
                     resolve:(RCTPromiseResolveBlock)resolve
                      reject:(RCTPromiseRejectBlock)reject;

+ (void)mergePdfs:(NSArray *)uris
        outputUri:(NSString *)outputUri
          resolve:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject;

+ (void)splitPdf:(NSString *)uri
 outputDirectory:(NSString *)outputDirectory
         options:(NSDictionary *)options
         resolve:(RCTPromiseResolveBlock)resolve
          reject:(RCTPromiseRejectBlock)reject;

+ (void)editPdfPages:(NSString *)uri
           outputUri:(NSString *)outputUri
          operations:(NSDictionary *)operations
             resolve:(RCTPromiseResolveBlock)resolve
              reject:(RCTPromiseRejectBlock)reject;

+ (void)compressPdf:(NSString *)uri
          outputUri:(NSString *)outputUri
            options:(NSDictionary *)options
            resolve:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject;

+ (void)closePdfSession:(NSString *)sessionHandle;

#pragma mark - File gateway

+ (void)pickPhotos:(double)limit
           resolve:(RCTPromiseResolveBlock)resolve
            reject:(RCTPromiseRejectBlock)reject;

+ (void)pickDocuments:(NSArray<NSString *> *)utisOrMimeTypes
        allowMultiple:(BOOL)allowMultiple
              resolve:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject;

+ (void)ensureLocal:(NSString *)uri
            resolve:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject;

+ (void)saveToPhotos:(NSArray<NSString *> *)uris
             resolve:(RCTPromiseResolveBlock)resolve
              reject:(RCTPromiseRejectBlock)reject;

+ (void)saveToDownloads:(NSArray<NSString *> *)uris
                resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject;

+ (void)createZip:(NSArray<NSString *> *)uris
          zipName:(NSString *)zipName
          resolve:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject;

+ (void)freeDiskSpace:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject;

+ (NSString *)sanitiseFilename:(NSString *)name;

+ (void)resolveCollision:(NSString *)directory
                filename:(NSString *)filename
                 resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject;

+ (void)takePendingFiles:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject;

+ (void)installIncomingFilesHandler:(void (^)(void))handler;

+ (void)clearTemporaryFiles:(RCTPromiseResolveBlock)resolve
                     reject:(RCTPromiseRejectBlock)reject;

@end

NS_ASSUME_NONNULL_END
