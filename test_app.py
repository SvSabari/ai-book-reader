from app import extract_book_html
import os

print("Testing extract_book_html on dummy.pdf")
res = extract_book_html("dummy.pdf")
print("Length of result:", len(res))
if "data:image" in res:
    print("Base64 images were extracted successfully!")
else:
    print("No images found in dummy.pdf (or not extracted correctly)")
    
print("Result start:", res[:200])
