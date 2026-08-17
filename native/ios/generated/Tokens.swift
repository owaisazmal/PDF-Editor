// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0
//
// GENERATED FILE — DO NOT EDIT.
// Source: src/theme/tokens.ts   Regenerate: npm run tokens:gen

import CoreGraphics
import Foundation

/// Design tokens shared by the app, the share extension and ConverterCore.
public enum Tokens {

  /// Straight (non-premultiplied) sRGB, 0...1 per channel.
  public struct RGBA: Equatable, Sendable {
    public let red: CGFloat
    public let green: CGFloat
    public let blue: CGFloat
    public let alpha: CGFloat

    public init(_ red: CGFloat, _ green: CGFloat, _ blue: CGFloat, _ alpha: CGFloat) {
      self.red = red
      self.green = green
      self.blue = blue
      self.alpha = alpha
    }
  }

  public struct TypeStyle: Equatable, Sendable {
    public let fontFamily: String
    public let fontSize: CGFloat
    public let lineHeight: CGFloat
    public let letterSpacing: CGFloat
  }

  public struct Elevation: Equatable, Sendable {
    public let opacity: CGFloat
    public let radius: CGFloat
    public let offsetY: CGFloat
  }

  public struct ColorTokens: Equatable, Sendable {
    public let bgCanvas: RGBA
    public let bgSurface: RGBA
    public let bgRaised: RGBA
    public let bgSunken: RGBA
    public let bgScrim: RGBA
    public let borderHairline: RGBA
    public let borderDefault: RGBA
    public let borderControl: RGBA
    public let borderFocus: RGBA
    public let textPrimary: RGBA
    public let textSecondary: RGBA
    public let textTertiary: RGBA
    public let textOnAccent: RGBA
    public let textOnAccentDeep: RGBA
    public let textDisabled: RGBA
    public let accentFill: RGBA
    public let accentInk: RGBA
    public let accentDeep: RGBA
    public let accentSoft: RGBA
    public let successInk: RGBA
    public let successBg: RGBA
    public let warningInk: RGBA
    public let warningBg: RGBA
    public let dangerInk: RGBA
    public let dangerBg: RGBA
    public let shadowColor: RGBA

    public init(bgCanvas: RGBA, bgSurface: RGBA, bgRaised: RGBA, bgSunken: RGBA, bgScrim: RGBA, borderHairline: RGBA, borderDefault: RGBA, borderControl: RGBA, borderFocus: RGBA, textPrimary: RGBA, textSecondary: RGBA, textTertiary: RGBA, textOnAccent: RGBA, textOnAccentDeep: RGBA, textDisabled: RGBA, accentFill: RGBA, accentInk: RGBA, accentDeep: RGBA, accentSoft: RGBA, successInk: RGBA, successBg: RGBA, warningInk: RGBA, warningBg: RGBA, dangerInk: RGBA, dangerBg: RGBA, shadowColor: RGBA) {
      self.bgCanvas = bgCanvas
      self.bgSurface = bgSurface
      self.bgRaised = bgRaised
      self.bgSunken = bgSunken
      self.bgScrim = bgScrim
      self.borderHairline = borderHairline
      self.borderDefault = borderDefault
      self.borderControl = borderControl
      self.borderFocus = borderFocus
      self.textPrimary = textPrimary
      self.textSecondary = textSecondary
      self.textTertiary = textTertiary
      self.textOnAccent = textOnAccent
      self.textOnAccentDeep = textOnAccentDeep
      self.textDisabled = textDisabled
      self.accentFill = accentFill
      self.accentInk = accentInk
      self.accentDeep = accentDeep
      self.accentSoft = accentSoft
      self.successInk = successInk
      self.successBg = successBg
      self.warningInk = warningInk
      self.warningBg = warningBg
      self.dangerInk = dangerInk
      self.dangerBg = dangerBg
      self.shadowColor = shadowColor
    }
  }

  public static let light = ColorTokens(
      bgCanvas: RGBA(0.9922, 0.9843, 0.8314, 1.0000),
      bgSurface: RGBA(1.0000, 0.9961, 0.9412, 1.0000),
      bgRaised: RGBA(1.0000, 1.0000, 1.0000, 1.0000),
      bgSunken: RGBA(0.9647, 0.9490, 0.7765, 1.0000),
      bgScrim: RGBA(0.1412, 0.0902, 0.0314, 0.5500),
      borderHairline: RGBA(0.8941, 0.8627, 0.6588, 1.0000),
      borderDefault: RGBA(0.7882, 0.7451, 0.5255, 1.0000),
      borderControl: RGBA(0.5529, 0.3529, 0.1686, 1.0000),
      borderFocus: RGBA(0.6588, 0.3725, 0.1176, 1.0000),
      textPrimary: RGBA(0.1412, 0.0902, 0.0314, 1.0000),
      textSecondary: RGBA(0.4353, 0.3137, 0.1529, 1.0000),
      textTertiary: RGBA(0.5529, 0.3529, 0.1686, 1.0000),
      textOnAccent: RGBA(0.1412, 0.0902, 0.0314, 1.0000),
      textOnAccentDeep: RGBA(1.0000, 1.0000, 1.0000, 1.0000),
      textDisabled: RGBA(0.6588, 0.5804, 0.4078, 1.0000),
      accentFill: RGBA(0.8314, 0.4941, 0.1882, 1.0000),
      accentInk: RGBA(0.6588, 0.3725, 0.1176, 1.0000),
      accentDeep: RGBA(0.5529, 0.3529, 0.1686, 1.0000),
      accentSoft: RGBA(0.9686, 0.9059, 0.7843, 1.0000),
      successInk: RGBA(0.2078, 0.4078, 0.1843, 1.0000),
      successBg: RGBA(0.9059, 0.9373, 0.8275, 1.0000),
      warningInk: RGBA(0.4784, 0.3608, 0.0588, 1.0000),
      warningBg: RGBA(0.9608, 0.9373, 0.7843, 1.0000),
      dangerInk: RGBA(0.6118, 0.2314, 0.1333, 1.0000),
      dangerBg: RGBA(0.9725, 0.8902, 0.8510, 1.0000),
      shadowColor: RGBA(0.1412, 0.0902, 0.0314, 1.0000)
  )

  public static let dark = ColorTokens(
      bgCanvas: RGBA(0.0902, 0.0667, 0.0392, 1.0000),
      bgSurface: RGBA(0.1294, 0.1020, 0.0667, 1.0000),
      bgRaised: RGBA(0.1725, 0.1373, 0.0902, 1.0000),
      bgSunken: RGBA(0.0706, 0.0510, 0.0275, 1.0000),
      bgScrim: RGBA(0.0000, 0.0000, 0.0000, 0.6600),
      borderHairline: RGBA(0.2275, 0.1804, 0.1137, 1.0000),
      borderDefault: RGBA(0.3216, 0.2549, 0.1647, 1.0000),
      borderControl: RGBA(0.5412, 0.4392, 0.2627, 1.0000),
      borderFocus: RGBA(0.8314, 0.4941, 0.1882, 1.0000),
      textPrimary: RGBA(0.9922, 0.9843, 0.8314, 1.0000),
      textSecondary: RGBA(0.8471, 0.8118, 0.6431, 1.0000),
      textTertiary: RGBA(0.6627, 0.6039, 0.4314, 1.0000),
      textOnAccent: RGBA(0.0902, 0.0667, 0.0392, 1.0000),
      textOnAccentDeep: RGBA(0.0902, 0.0667, 0.0392, 1.0000),
      textDisabled: RGBA(0.4314, 0.3804, 0.2588, 1.0000),
      accentFill: RGBA(0.8314, 0.4941, 0.1882, 1.0000),
      accentInk: RGBA(0.8314, 0.4941, 0.1882, 1.0000),
      accentDeep: RGBA(0.8314, 0.4941, 0.1882, 1.0000),
      accentSoft: RGBA(0.1961, 0.1412, 0.0627, 1.0000),
      successInk: RGBA(0.6510, 0.7804, 0.4941, 1.0000),
      successBg: RGBA(0.1490, 0.1882, 0.1020, 1.0000),
      warningInk: RGBA(0.8510, 0.7569, 0.4510, 1.0000),
      warningBg: RGBA(0.2000, 0.1686, 0.0706, 1.0000),
      dangerInk: RGBA(0.9098, 0.6314, 0.5176, 1.0000),
      dangerBg: RGBA(0.2314, 0.1255, 0.0863, 1.0000),
      shadowColor: RGBA(0.0000, 0.0000, 0.0000, 1.0000)
  )

  public static func colors(dark: Bool) -> ColorTokens { dark ? Tokens.dark : Tokens.light }

  public enum Space {
    public static let xs: CGFloat = 4
    public static let sm: CGFloat = 8
    public static let md: CGFloat = 12
    public static let lg: CGFloat = 16
    public static let xl: CGFloat = 20
    public static let s2xl: CGFloat = 24
    public static let s3xl: CGFloat = 32
    public static let s4xl: CGFloat = 40
    public static let s5xl: CGFloat = 48
    public static let s6xl: CGFloat = 64
  }

  public enum Radius {
    public static let sm: CGFloat = 8
    public static let md: CGFloat = 12
    public static let lg: CGFloat = 16
    public static let xl: CGFloat = 24
    public static let pill: CGFloat = 999
  }

  public enum Duration {
    public static let instant: TimeInterval = 100
    public static let fast: TimeInterval = 160
    public static let normal: TimeInterval = 240
    public static let slow: TimeInterval = 380
  }

  public enum FontFamily {
    public static let regular = "Manrope_400Regular"
    public static let medium = "Manrope_500Medium"
    public static let semibold = "Manrope_600SemiBold"
    public static let bold = "Manrope_700Bold"
    public static let extrabold = "Manrope_800ExtraBold"
    public static let mono = "monospace"
  }

  public enum Typography {
    public static let display = TypeStyle(fontFamily: "Manrope_800ExtraBold", fontSize: 34, lineHeight: 40, letterSpacing: -0.8)
    public static let h1 = TypeStyle(fontFamily: "Manrope_700Bold", fontSize: 28, lineHeight: 34, letterSpacing: -0.5)
    public static let h2 = TypeStyle(fontFamily: "Manrope_700Bold", fontSize: 22, lineHeight: 28, letterSpacing: -0.3)
    public static let h3 = TypeStyle(fontFamily: "Manrope_600SemiBold", fontSize: 18, lineHeight: 24, letterSpacing: -0.2)
    public static let body = TypeStyle(fontFamily: "Manrope_500Medium", fontSize: 16, lineHeight: 24, letterSpacing: 0)
    public static let bodySm = TypeStyle(fontFamily: "Manrope_500Medium", fontSize: 14, lineHeight: 20, letterSpacing: 0)
    public static let label = TypeStyle(fontFamily: "Manrope_600SemiBold", fontSize: 13, lineHeight: 16, letterSpacing: 0.3)
    public static let caption = TypeStyle(fontFamily: "Manrope_500Medium", fontSize: 12, lineHeight: 16, letterSpacing: 0.1)
    public static let mono = TypeStyle(fontFamily: "monospace", fontSize: 14, lineHeight: 20, letterSpacing: 0)
    public static let monoLg = TypeStyle(fontFamily: "monospace", fontSize: 20, lineHeight: 26, letterSpacing: -0.2)
  }

  public enum Elevations {
    public static let none = Elevation(opacity: 0, radius: 0, offsetY: 0)
    public static let sm = Elevation(opacity: 0.07, radius: 8, offsetY: 2)
    public static let md = Elevation(opacity: 0.1, radius: 16, offsetY: 4)
    public static let lg = Elevation(opacity: 0.14, radius: 28, offsetY: 10)
  }

  public static let hitTarget: CGFloat = 48
}
