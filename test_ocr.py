import cv2
import pytesseract
import os
import numpy as np

pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

def extract_image_text_robust(file_path):
    print(f"Reading file: {file_path}")
    image = cv2.imread(file_path)
    if image is None: return "Load failed"

    h, w = image.shape[:2]
    print(f"Original Dimensions: {w}x{h}")
    
    results = []
    # Try different scales
    for scale in [2.0]:
        new_w, new_h = int(w*scale), int(h*scale)
        resized = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)
        
        # Denoising
        denoised = cv2.fastNlMeansDenoisingColored(resized, None, 10, 10, 7, 21)
        gray = cv2.cvtColor(denoised, cv2.COLOR_BGR2GRAY)
        
        # 1. PSM 3 on Gray
        results.append(pytesseract.image_to_string(gray, config='--oem 3 --psm 3'))
        
        # 2. PSM 4 (Single Column)
        results.append(pytesseract.image_to_string(gray, config='--oem 3 --psm 4'))
        
        # 3. Adaptive Threshold
        adaptive = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2)
        results.append(pytesseract.image_to_string(adaptive, config='--oem 3 --psm 6'))
        
    all_text = "\n".join(results)
    return all_text

file_path = r"c:\ai_book_reader\uploads\R AND D - visual selection (1).png"
print("--- START OCR ---")
res = extract_image_text_robust(file_path)
print(res)
print("--- END OCR ---")

file_path = r"c:\ai_book_reader\uploads\R AND D - visual selection (1).png"
print("--- START OCR ---")
res = extract_image_text_robust(file_path)
print(res)
print("--- END OCR ---")

keywords = ["Distribution", "Activities", "Pricing", "Detection", "OCR"]
found = [k for k in keywords if k.lower() in res.lower()]
print(f"Found Keywords: {found}")
