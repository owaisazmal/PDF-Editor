// Copyright (c) 2026 Owais Khan
// Licensed under the Apache License, Version 2.0

package com.owaiskhan.converter.core

import android.graphics.Bitmap
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
import java.io.File
import java.io.IOException

/**
 * Turns an EXIF orientation tag into pixels.
 *
 * `ImageDecoder` does this on API 28 and above. `BitmapFactory`, which is the only decoder
 * available below that, does not: it hands back the stored pixels and leaves the tag for
 * somebody else to honour. Since every file this app writes is written with orientation 1,
 * that somebody has to be us, or a photo taken in portrait is saved on its side.
 *
 * Shared rather than copied. `RasterCodec` and `PdfEngine` both need it, and a second copy
 * of a transform table is a second place for a case to go missing.
 */
internal object ExifOrientation {

  /** The stored orientation, or `ORIENTATION_NORMAL` if the file does not say. */
  fun read(file: File): Int =
    try {
      ExifInterface(file).getAttributeInt(
        ExifInterface.TAG_ORIENTATION,
        ExifInterface.ORIENTATION_NORMAL,
      )
    } catch (error: IOException) {
      ExifInterface.ORIENTATION_NORMAL
    }

  /** True when the orientation exchanges width and height. */
  fun swapsAxes(orientation: Int): Boolean =
    when (orientation) {
      ExifInterface.ORIENTATION_ROTATE_90,
      ExifInterface.ORIENTATION_ROTATE_270,
      ExifInterface.ORIENTATION_TRANSPOSE,
      ExifInterface.ORIENTATION_TRANSVERSE,
      -> true
      else -> false
    }

  /**
   * Redraws the bitmap the right way up, recycling the original when it is replaced.
   *
   * Returns the same instance when the orientation is already normal, so the common case
   * costs nothing.
   */
  fun apply(bitmap: Bitmap, orientation: Int): Bitmap {
    val matrix = Matrix()
    when (orientation) {
      ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
      ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
      ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
      ExifInterface.ORIENTATION_TRANSPOSE -> {
        matrix.postRotate(90f)
        matrix.postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_TRANSVERSE -> {
        matrix.postRotate(270f)
        matrix.postScale(-1f, 1f)
      }
      else -> return bitmap
    }

    return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
      .also { if (it !== bitmap) bitmap.recycle() }
  }

  /** Reads and applies in one step, for a decoder that ignored the tag. */
  fun apply(bitmap: Bitmap, file: File): Bitmap = apply(bitmap, read(file))
}
