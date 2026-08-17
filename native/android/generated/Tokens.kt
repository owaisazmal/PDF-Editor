// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0
//
// GENERATED FILE — DO NOT EDIT.
// Source: src/theme/tokens.ts   Regenerate: npm run tokens:gen

package com.owaiskhan.converter.theme

/** Design tokens shared by the app, the share target and the converter library. */
public object Tokens {

  /** Packed ARGB, matching androidx.compose.ui.graphics.Color's constructor. */
  public data class ColorTokens(
  val bgCanvas: Long,
  val bgSurface: Long,
  val bgRaised: Long,
  val bgSunken: Long,
  val bgScrim: Long,
  val borderHairline: Long,
  val borderDefault: Long,
  val borderControl: Long,
  val borderFocus: Long,
  val textPrimary: Long,
  val textSecondary: Long,
  val textTertiary: Long,
  val textOnAccent: Long,
  val textOnAccentDeep: Long,
  val textDisabled: Long,
  val accentFill: Long,
  val accentInk: Long,
  val accentDeep: Long,
  val accentSoft: Long,
  val successInk: Long,
  val successBg: Long,
  val warningInk: Long,
  val warningBg: Long,
  val dangerInk: Long,
  val dangerBg: Long,
  val shadowColor: Long,
  )

  public data class TypeStyle(
    val fontFamily: String,
    val fontSize: Float,
    val lineHeight: Float,
    val letterSpacing: Float,
  )

  public data class Elevation(
    val opacity: Float,
    val radius: Float,
    val offsetY: Float,
    val androidElevation: Float,
  )

  @JvmField
  val LIGHT = ColorTokens(
    bgCanvas = 0xFFFDFBD4,
    bgSurface = 0xFFFFFEF0,
    bgRaised = 0xFFFFFFFF,
    bgSunken = 0xFFF6F2C6,
    bgScrim = 0x8C241708,
    borderHairline = 0xFFE4DCA8,
    borderDefault = 0xFFC9BE86,
    borderControl = 0xFF8D5A2B,
    borderFocus = 0xFFA85F1E,
    textPrimary = 0xFF241708,
    textSecondary = 0xFF6F5027,
    textTertiary = 0xFF8D5A2B,
    textOnAccent = 0xFF241708,
    textOnAccentDeep = 0xFFFFFFFF,
    textDisabled = 0xFFA89468,
    accentFill = 0xFFD47E30,
    accentInk = 0xFFA85F1E,
    accentDeep = 0xFF8D5A2B,
    accentSoft = 0xFFF7E7C8,
    successInk = 0xFF35682F,
    successBg = 0xFFE7EFD3,
    warningInk = 0xFF7A5C0F,
    warningBg = 0xFFF5EFC8,
    dangerInk = 0xFF9C3B22,
    dangerBg = 0xFFF8E3D9,
    shadowColor = 0xFF241708,
  )

  @JvmField
  val DARK = ColorTokens(
    bgCanvas = 0xFF17110A,
    bgSurface = 0xFF211A11,
    bgRaised = 0xFF2C2317,
    bgSunken = 0xFF120D07,
    bgScrim = 0xA8000000,
    borderHairline = 0xFF3A2E1D,
    borderDefault = 0xFF52412A,
    borderControl = 0xFF8A7043,
    borderFocus = 0xFFD47E30,
    textPrimary = 0xFFFDFBD4,
    textSecondary = 0xFFD8CFA4,
    textTertiary = 0xFFA99A6E,
    textOnAccent = 0xFF17110A,
    textOnAccentDeep = 0xFF17110A,
    textDisabled = 0xFF6E6142,
    accentFill = 0xFFD47E30,
    accentInk = 0xFFD47E30,
    accentDeep = 0xFFD47E30,
    accentSoft = 0xFF322410,
    successInk = 0xFFA6C77E,
    successBg = 0xFF26301A,
    warningInk = 0xFFD9C173,
    warningBg = 0xFF332B12,
    dangerInk = 0xFFE8A184,
    dangerBg = 0xFF3B2016,
    shadowColor = 0xFF000000,
  )

  @JvmStatic
  public fun colors(dark: Boolean): ColorTokens = if (dark) DARK else LIGHT

  public object Space {
    const val xs: Int = 4
    const val sm: Int = 8
    const val md: Int = 12
    const val lg: Int = 16
    const val xl: Int = 20
    const val S2xl: Int = 24
    const val S3xl: Int = 32
    const val S4xl: Int = 40
    const val S5xl: Int = 48
    const val S6xl: Int = 64
  }

  public object Radius {
    const val sm: Int = 8
    const val md: Int = 12
    const val lg: Int = 16
    const val xl: Int = 24
    const val pill: Int = 999
  }

  public object Duration {
    const val instant: Long = 100
    const val fast: Long = 160
    const val normal: Long = 240
    const val slow: Long = 380
  }

  public object FontFamily {
    const val REGULAR: String = "Manrope_400Regular"
    const val MEDIUM: String = "Manrope_500Medium"
    const val SEMIBOLD: String = "Manrope_600SemiBold"
    const val BOLD: String = "Manrope_700Bold"
    const val EXTRABOLD: String = "Manrope_800ExtraBold"
    const val MONO: String = "monospace"
  }

  public object Typography {
    @JvmField val DISPLAY = TypeStyle("Manrope_800ExtraBold", 34f, 40f, -0.8f)
    @JvmField val H1 = TypeStyle("Manrope_700Bold", 28f, 34f, -0.5f)
    @JvmField val H2 = TypeStyle("Manrope_700Bold", 22f, 28f, -0.3f)
    @JvmField val H3 = TypeStyle("Manrope_600SemiBold", 18f, 24f, -0.2f)
    @JvmField val BODY = TypeStyle("Manrope_500Medium", 16f, 24f, 0f)
    @JvmField val BODYSM = TypeStyle("Manrope_500Medium", 14f, 20f, 0f)
    @JvmField val LABEL = TypeStyle("Manrope_600SemiBold", 13f, 16f, 0.3f)
    @JvmField val CAPTION = TypeStyle("Manrope_500Medium", 12f, 16f, 0.1f)
    @JvmField val MONO = TypeStyle("monospace", 14f, 20f, 0f)
    @JvmField val MONOLG = TypeStyle("monospace", 20f, 26f, -0.2f)
  }

  public object Elevations {
    @JvmField val NONE = Elevation(0f, 0f, 0f, 0f)
    @JvmField val SM = Elevation(0.07f, 8f, 2f, 2f)
    @JvmField val MD = Elevation(0.1f, 16f, 4f, 5f)
    @JvmField val LG = Elevation(0.14f, 28f, 10f, 12f)
  }

  public const val HIT_TARGET: Int = 48
}
