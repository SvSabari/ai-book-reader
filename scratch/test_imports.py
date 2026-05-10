import time

def test_import(module_name):
    start = time.time()
    try:
        __import__(module_name)
        end = time.time()
        print(f"Import {module_name} took {end - start:.4f}s")
    except ImportError:
        print(f"Module {module_name} not found")

modules = [
    "flask",
    "flask_socketio",
    "transformers",
    "torch",
    "cv2",
    "numpy",
    "pytesseract",
    "fitz",
    "docx",
    "pptx",
    "ebooklib"
]

for m in modules:
    test_import(m)
