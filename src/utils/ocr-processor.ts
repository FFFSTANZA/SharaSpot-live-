

import { ImageAnnotatorClient } from '@google-cloud/vision';
import sharp from 'sharp';
import { OCR_CONFIG } from '../config/ocr-config';
import { logger } from './logger';





const visionClient = new ImageAnnotatorClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});





export interface OCRResult {
  success: boolean;
  reading?: number;
  confidence?: number;
  rawText?: string;
  error?: string;
  suggestions?: string[];
  processingTime?: number;
}

export interface PreprocessOptions {
  enhanceContrast?: boolean;
  denoise?: boolean;
  targetSize?: { width: number; height: number };
  autoRotate?: boolean;
  threshold?: boolean;
}

interface OCRRawResult {
  success: boolean;
  text?: string;
  confidence?: number;
  error?: string;
}

interface NumberCandidate {
  value: number;
  confidence: number;
  position: number;
  context: string;
}





/**
 * ✅ PRODUCTION: Extract kWh reading from image buffer with preprocessing, OCR, and validation
 * Handles multiple preprocessing strategies for maximum accuracy
 */
export async function extractKwhReading(
  imageBuffer: Buffer,
  options: PreprocessOptions = OCR_CONFIG.PREPROCESSING
): Promise<OCRResult> {
  const startTime = Date.now();
  
  try {
    logger.info('🔍 Starting OCR processing with Google Vision API', { 
      bufferSize: imageBuffer.length 
    });

    
    let processedImage = await preprocessImage(imageBuffer, options);
    let ocrResult = await performOCR(processedImage);

    
    if (ocrResult.confidence && ocrResult.confidence < OCR_CONFIG.MIN_OCR_CONFIDENCE) {
      logger.info('⚠️ Low confidence, retrying with aggressive preprocessing');
      processedImage = await preprocessImageAggressive(imageBuffer);
      ocrResult = await performOCR(processedImage);
    }

    
    if (ocrResult.confidence && ocrResult.confidence < OCR_CONFIG.MIN_OCR_CONFIDENCE) {
      logger.info('⚠️ Still low confidence, trying adaptive threshold');
      processedImage = await preprocessWithAdaptiveThreshold(imageBuffer);
      ocrResult = await performOCR(processedImage);
    }

    if (!ocrResult.success) {
      return {
        success: false,
        error: ocrResult.error || 'OCR failed',
        suggestions: getRetrySuggestions(ocrResult.confidence, ocrResult.text),
        processingTime: Date.now() - startTime,
      };
    }

    
    const reading = extractReadingFromText(ocrResult.text || '');
    if (reading === null) {
      logger.warn('❌ No valid reading found', { rawText: ocrResult.text });
      return {
        success: false,
        rawText: ocrResult.text,
        confidence: ocrResult.confidence,
        error: 'No valid kWh reading found in image',
        suggestions: getRetrySuggestions(ocrResult.confidence, ocrResult.text),
        processingTime: Date.now() - startTime,
      };
    }

    
    const validation = validateReading(reading);
    if (!validation.valid) {
      logger.warn('❌ Reading validation failed', { reading, error: validation.error });
      return {
        success: false,
        reading,
        confidence: ocrResult.confidence,
        error: validation.error,
        suggestions: ['The reading looks unusual. Please verify the meter display is visible.'],
        processingTime: Date.now() - startTime,
      };
    }

    const processingTime = Date.now() - startTime;
    logger.info('✅ OCR successful', { 
      reading, 
      confidence: ocrResult.confidence, 
      processingTime 
    });

    return {
      success: true,
      reading,
      confidence: ocrResult.confidence,
      rawText: ocrResult.text,
      processingTime,
    };
  } catch (error) {
    logger.error('❌ OCR processing error', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown OCR error',
      suggestions: getRetrySuggestions(),
      processingTime: Date.now() - startTime,
    };
  }
}





export async function preprocessImage(
  imageBuffer: Buffer,
  options: PreprocessOptions = OCR_CONFIG.PREPROCESSING
): Promise<Buffer> {
  try {
    logger.debug('📸 Starting standard preprocessing');

    const {
      enhanceContrast = OCR_CONFIG.PREPROCESSING.enhanceContrast,
      denoise = OCR_CONFIG.PREPROCESSING.denoise,
      targetSize = OCR_CONFIG.PREPROCESSING.targetSize,
      autoRotate = true,
    } = options;

    let processor = sharp(imageBuffer);

    
    const metadata = await processor.metadata();
    logger.debug('📊 Image metadata', {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
    });

    
    if (autoRotate) {
      processor = processor.rotate();
    }

    
    if (metadata.width && metadata.width > targetSize.width) {
      processor = processor.resize(targetSize.width, targetSize.height, {
        fit: 'inside',
        withoutEnlargement: true,
        kernel: sharp.kernel.lanczos3, // High-quality resampling
      });
    }

    
    processor = processor.grayscale();

    
    if (enhanceContrast) {
      processor = processor.normalize({ lower: 1, upper: 99 });
    }

    
    if (denoise) {
      processor = processor.median(3);
    }

    
    processor = processor.sharpen({
      sigma: 1.5,
      m1: 1.0,
      m2: 0.7,
      x1: 3,
      y2: 15,
      y3: 15,
    });

    
    processor = processor.linear(1.5, -50);

    
    const result = await processor
      .png({ 
        quality: 100, 
        compressionLevel: 0,
        adaptiveFiltering: false 
      })
      .toBuffer();

    logger.debug('✅ Standard preprocessing complete', { 
      outputSize: result.length 
    });
    
    return result;
  } catch (error) {
    logger.error('❌ Standard preprocessing failed', { error });
    throw new Error(
      `Preprocessing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}





async function preprocessImageAggressive(imageBuffer: Buffer): Promise<Buffer> {
  try {
    logger.debug('🔥 Applying aggressive preprocessing');

    let processor = sharp(imageBuffer);

    const metadata = await processor.metadata();

    
    if (metadata.width && metadata.width > 1200) {
      processor = processor.resize(1200, 800, {
        fit: 'inside',
        withoutEnlargement: true,
        kernel: sharp.kernel.lanczos3,
      });
    }

    
    processor = processor.rotate();

    
    processor = processor.grayscale();

    
    processor = processor.normalize({ lower: 5, upper: 95 });

    
    processor = processor.median(5);

    
    processor = processor.sharpen({
      sigma: 2.0,
      m1: 1.5,
      m2: 0.5,
      x1: 2,
      y2: 10,
      y3: 20,
    });

    
    processor = processor.linear(2.0, -80);

    
    processor = processor.gamma(1.2);

    const result = await processor
      .png({ quality: 100, compressionLevel: 0 })
      .toBuffer();

    logger.debug('✅ Aggressive preprocessing complete');
    return result;
  } catch (error) {
    logger.error('❌ Aggressive preprocessing failed', { error });
    throw error;
  }
}





async function preprocessWithAdaptiveThreshold(imageBuffer: Buffer): Promise<Buffer> {
  try {
    logger.debug('🎯 Applying adaptive thresholding');

    let processor = sharp(imageBuffer);

    
    processor = processor.resize(1000, 1000, {
      fit: 'inside',
      withoutEnlargement: true,
    });

    
    processor = processor.rotate();

    
    processor = processor.grayscale();

    
    processor = processor.normalize();

    
    processor = processor.threshold(128, {
      grayscale: true,
    });

    
    processor = processor.sharpen();

    const result = await processor
      .png({ quality: 100 })
      .toBuffer();

    logger.debug('✅ Adaptive threshold preprocessing complete');
    return result;
  } catch (error) {
    logger.error('❌ Adaptive threshold preprocessing failed', { error });
    throw error;
  }
}





async function performOCR(imageBuffer: Buffer): Promise<OCRRawResult> {
  try {
    logger.debug('🤖 Calling Google Cloud Vision API');

    const [result] = await visionClient.textDetection({
      image: { content: imageBuffer },
    });

    const detections = result.textAnnotations;
    
    if (!detections || detections.length === 0) {
      logger.warn('⚠️ No text detected by Vision API');
      return {
        success: false,
        error: 'No text detected in image',
        confidence: 0,
      };
    }

    
    const fullText = detections[0].description || '';
    
    
    
    let totalConfidence = 0;
    let confidentWords = 0;

    
    for (let i = 1; i < detections.length; i++) {
      const detection = detections[i];
      const text = detection.description || '';
      
      
      let wordConfidence = 70; // Base confidence
      
      
      if (/\d/.test(text)) {
        wordConfidence += 15;
      }
      
      
      if (/kwh|energy|meter/i.test(text)) {
        wordConfidence += 10;
      }
      
      
      if (detection.boundingPoly?.vertices && detection.boundingPoly.vertices.length === 4) {
        wordConfidence += 5;
      }
      
      totalConfidence += wordConfidence;
      confidentWords++;
    }

    const avgConfidence = confidentWords > 0 ? totalConfidence / confidentWords : 70;

    logger.debug('📝 Vision API result', {
      confidence: avgConfidence.toFixed(1),
      textLength: fullText.length,
      wordCount: detections.length - 1,
      preview: fullText.substring(0, 100),
    });

    
    if (avgConfidence < OCR_CONFIG.MIN_OCR_CONFIDENCE * 0.5) {
      return {
        success: false,
        error: 'Very low confidence OCR result',
        confidence: avgConfidence,
        text: fullText.trim(),
      };
    }

    return {
      success: true,
      text: fullText.trim(),
      confidence: avgConfidence,
    };
  } catch (error) {
    logger.error('❌ Vision API execution error', { error });
    
    
    if (error instanceof Error) {
      if (error.message.includes('PERMISSION_DENIED')) {
        return {
          success: false,
          error: 'Vision API authentication failed. Check credentials.',
        };
      }
      if (error.message.includes('QUOTA_EXCEEDED')) {
        return {
          success: false,
          error: 'Vision API quota exceeded. Try again later.',
        };
      }
    }
    
    return {
      success: false,
      error: `Vision API error: ${error instanceof Error ? error.message : 'Unknown'}`,
    };
  }
}





function extractReadingFromText(text: string): number | null {
  
  const clean = text
    .replace(/[\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    // Fix common OCR mistakes
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/S/g, '5')
    .replace(/Z/g, '2')
    .replace(/B/g, '8');

  logger.debug('🧹 Cleaned OCR text', { original: text, cleaned: clean });

  
  const kwhPatterns = [
    /(?:K?W?H?\s*[:\-=]?\s*)(\d{2,6}(?:\.\d{1,3})?)/i,
    /(\d{2,6}(?:\.\d{1,3})?)\s*(?:K?W?H?)/i,
    /ENERGY[:\s]+(\d{2,6}(?:\.\d{1,3})?)/i,
    /METER[:\s]+(\d{2,6}(?:\.\d{1,3})?)/i,
    /READING[:\s]+(\d{2,6}(?:\.\d{1,3})?)/i,
  ];

  for (const pattern of kwhPatterns) {
    const match = clean.match(pattern);
    if (match && match[1]) {
      const num = parseFloat(match[1]);
      if (isValidReading(num)) {
        logger.info('✅ Found reading via kWh pattern', { pattern: pattern.source, reading: num });
        return num;
      }
    }
  }

  
  const candidates = extractNumberCandidates(clean);
  
  if (candidates.length === 1) {
    logger.info('✅ Single candidate found', { reading: candidates[0].value });
    return candidates[0].value;
  }

  if (candidates.length > 1) {
    
    const ranked = rankCandidates(candidates);
    logger.info('✅ Multiple candidates, selected best', {
      selected: ranked[0].value,
      allCandidates: ranked.map(c => c.value),
    });
    return ranked[0].value;
  }

  logger.warn('❌ No valid candidates found');
  return null;
}

function extractNumberCandidates(text: string): NumberCandidate[] {
  const candidates: NumberCandidate[] = [];
  
  
  const numberPattern = /(\d{2,6}(?:\.\d{1,3})?)/g;
  let match;
  
  while ((match = numberPattern.exec(text)) !== null) {
    const value = parseFloat(match[1]);
    
    if (isValidReading(value)) {
      
      const start = Math.max(0, match.index - 20);
      const end = Math.min(text.length, match.index + match[0].length + 20);
      const context = text.substring(start, end);
      
      
      let confidence = 50;
      
      
      if (/K?W?H|ENERGY|METER|READING|CONSUMPTION/i.test(context)) {
        confidence += 30;
      }
      
      
      if (match[1].includes('.')) {
        confidence += 10;
      }
      
      
      if (value >= 100 && value <= 10000) {
        confidence += 10;
      }
      
      candidates.push({
        value,
        confidence,
        position: match.index,
        context,
      });
    }
  }
  
  return candidates;
}

function rankCandidates(candidates: NumberCandidate[]): NumberCandidate[] {
  return candidates.sort((a, b) => {
    
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }
    
    return b.value - a.value;
  });
}

function isValidReading(num: number): boolean {
  return (
    !isNaN(num) &&
    isFinite(num) &&
    num >= OCR_CONFIG.VALID_RANGE.min &&
    num <= OCR_CONFIG.VALID_RANGE.max
  );
}





export function validateReading(reading: number): { valid: boolean; error?: string } {
  if (typeof reading !== 'number' || isNaN(reading) || !isFinite(reading)) {
    return { valid: false, error: 'Invalid number format' };
  }
  
  if (reading <= 0) {
    return { valid: false, error: 'Reading must be positive' };
  }
  
  if (reading < OCR_CONFIG.VALID_RANGE.min) {
    return { 
      valid: false, 
      error: `Reading too small (minimum: ${OCR_CONFIG.VALID_RANGE.min} kWh)` 
    };
  }
  
  if (reading > OCR_CONFIG.VALID_RANGE.max) {
    return { 
      valid: false, 
      error: `Reading too large (maximum: ${OCR_CONFIG.VALID_RANGE.max} kWh)` 
    };
  }
  
  const decimals = (reading.toString().split('.')[1] || '').length;
  if (decimals > OCR_CONFIG.MAX_DECIMAL_PLACES) {
    return { valid: false, error: 'Too many decimal places' };
  }
  
  return { valid: true };
}





export function calculateConsumption(
  start: number,
  end: number
): { valid: boolean; consumption?: number; error?: string } {
  const v1 = validateReading(start);
  const v2 = validateReading(end);
  
  if (!v1.valid) return { valid: false, error: `Start reading: ${v1.error}` };
  if (!v2.valid) return { valid: false, error: `End reading: ${v2.error}` };
  
  if (end <= start) {
    return { 
      valid: false, 
      error: 'End reading must be greater than start reading' 
    };
  }

  const cons = end - start;
  
  if (cons < OCR_CONFIG.CONSUMPTION_RANGE.min) {
    return { 
      valid: false, 
      error: `Consumption too low (< ${OCR_CONFIG.CONSUMPTION_RANGE.min} kWh)` 
    };
  }
  
  if (cons > OCR_CONFIG.CONSUMPTION_RANGE.max) {
    return { 
      valid: false, 
      error: `Consumption too high (> ${OCR_CONFIG.CONSUMPTION_RANGE.max} kWh)` 
    };
  }

  return {
    valid: true,
    consumption: Math.round(cons * 100) / 100,
  };
}

export function validateConsumptionWithContext(
  consumption: number,
  durationMinutes: number,
  chargerPowerKw: number,
  batteryCapacityKwh?: number
): { valid: boolean; warnings?: string[]; error?: string } {
  const durationHours = durationMinutes / 60;
  const theoreticalMax = durationHours * chargerPowerKw * 0.95;

  if (consumption > theoreticalMax * 1.15) {
    return {
      valid: false,
      error: `Consumption (${consumption} kWh) exceeds theoretical maximum (${theoreticalMax.toFixed(1)} kWh)`,
    };
  }

  if (batteryCapacityKwh && consumption > batteryCapacityKwh * 1.05) {
    return {
      valid: false,
      error: `Consumption exceeds battery capacity (${batteryCapacityKwh} kWh)`,
    };
  }

  const warnings: string[] = [];
  const avgPower = consumption / durationHours;
  
  if (avgPower > chargerPowerKw * 0.98) {
    warnings.push('Average power very close to charger limit – verify readings');
  }

  const efficiency = (consumption / (durationHours * chargerPowerKw)) * 100;
  if (efficiency < 60) {
    warnings.push(`Low efficiency (${efficiency.toFixed(0)}%) – may indicate partial charge`);
  }

  return { valid: true, warnings: warnings.length ? warnings : undefined };
}





export function formatReading(reading: number): string {
  return `${reading.toFixed(1)} kWh`;
}

export function getRetrySuggestions(confidence?: number, rawText?: string): string[] {
  const tips = OCR_CONFIG.MESSAGES.RETRY_TIPS;
  const suggestions: string[] = [];

  if (confidence === undefined || confidence < OCR_CONFIG.MESSAGES.LOW_CONFIDENCE_THRESHOLD) {
    suggestions.push(tips.lighting, tips.focus, tips.steady);
  }

  if (!rawText || rawText.replace(/\D/g, '').length < 3) {
    suggestions.push(tips.visible, tips.numbers);
  }

  return [...new Set(suggestions)];
}

export function shouldWarnLowConfidence(confidence: number): boolean {
  return confidence < OCR_CONFIG.MIN_DISPLAY_CONFIDENCE;
}

export function isGoodConfidence(confidence: number): boolean {
  return confidence >= OCR_CONFIG.GOOD_CONFIDENCE;
}





export default {
  extractKwhReading,
  preprocessImage,
  validateReading,
  calculateConsumption,
  validateConsumptionWithContext,
  formatReading,
  getRetrySuggestions,
  shouldWarnLowConfidence,
  isGoodConfidence,
};