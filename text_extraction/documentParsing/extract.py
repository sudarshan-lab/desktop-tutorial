import numpy as np 
import pandas as pd 
import cv2
import pytesseract
import spacy
import matplotlib.pyplot as plt
from io import BytesIO
from pdf2image import convert_from_path
from PIL import Image, ImageEnhance
import numpy as np
import fitz
import PyPDF2
import pdfplumber
import camelot
import os


def extractionUsingPillow(filePath):
    images = convert_from_path(filePath)
    grey_image_pil = PIL.ImageOps.grayscale(images[0])
    text_from_grey_image = pytesseract.image_to_string(grey_image_pil)
    return text_from_grey_image

def extractionUsingOpenCV(filePath):
    doc_img = cv2.imread(filePath)
    text_from_cv = pytesseract.image_to_string(doc_img)
    return text_from_cv

def preprocess_image(image_path):
    
    img = cv2.imread(image_path)   # Open the image using OpenCV

    
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) # Convert the image to grayscale

    
    thresh = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2) # Apply adaptive thresholding for better results

    
    kernel = np.ones((3, 3), np.uint8)  
    opening = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel, iterations=2) # Perform morphological transformations to clean up the image
    sure_bg = cv2.dilate(opening, kernel, iterations=3)

    return sure_bg

def extractTextAfterPreProcessing(image_path):
    
    preprocessed_img = preprocess_image(image_path)# Preprocess the image

    
    cv2.imwrite("preprocessed_image.png", preprocessed_img) # Save the preprocessed image

    extractedText = pytesseract.image_to_string(preprocessed_img)

    return extractedText



# pre processing the document before extraction
filename = 'gradesheet btech.pdf'
images = convert_from_path(filename, poppler_path=poppler_path)

class ImagePreprocessor:
    def __init__(self):
        self.adaptive_threshold_block_size = 20
        self.adaptive_threshold_constant = 2
        self.gaussian_blur_kernel_size = (5, 5)
        self.canny_threshold1 = 50
        self.canny_threshold2 = 150
        self.machine_learning_model = None
        
    def preprocess_image(self, image):
        grayscale_image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        
        texture_features = self.analyze_texture(grayscale_image)

        optimized_parameters = self.optimize_parameters(texture_features)

        threshold_image = cv2.adaptiveThreshold(grayscale_image, 255,
                                                cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                                cv2.THRESH_BINARY_INV,
                                                optimized_parameters['adaptive_threshold_block_size'],
                                                optimized_parameters['adaptive_threshold_constant'])

        denoised_image = cv2.GaussianBlur(threshold_image, optimized_parameters['gaussian_blur_kernel_size'], 0)

        edges = cv2.Canny(denoised_image, optimized_parameters['canny_threshold1'], optimized_parameters['canny_threshold2'])

        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        mask = np.zeros_like(grayscale_image)  
        largest_contour = max(contours, key=cv2.contourArea)
        cv2.drawContours(mask, [largest_contour], -1, (255), thickness=cv2.FILLED)

        
        masked_image = cv2.bitwise_and(grayscale_image, grayscale_image, mask=mask)

        multi_scale_features = self.perform_multi_scale_analysis(masked_image)

        return masked_image

    
    def analyze_texture(self, image):
        return {'texture_feature1': 0.5, 'texture_feature2': 0.3}
    
    def optimize_parameters(self, features):
        return {'adaptive_threshold_block_size': 11, 'adaptive_threshold_constant': 2,
                'gaussian_blur_kernel_size': (5, 5), 'canny_threshold1': 50, 'canny_threshold2': 150}
    
    def perform_multi_scale_analysis(self, image):
        return {'multi_scale_feature1': 0.7, 'multi_scale_feature2': 0.9}
# Initialize ImagePreprocessor
preprocessor = ImagePreprocessor()
result = pd.DataFrame()
fig, axes = plt.subplots(nrows=len(images), figsize=(6, 2*len(images)))
# Preprocess image
for ax, image in zip(axes, images):
    buffer = BytesIO()
    image.save(buffer, format='JPEG')
    buffer.seek(0)
    image = cv2.imdecode(np.frombuffer(buffer.getvalue(), dtype=np.uint8), -1)
    preprocessed_image = preprocessor.preprocess_image(image)
    image_pil = Image.fromarray(np.uint8(preprocessed_image))
    text = pytesseract.image_to_data(preprocessed_image)
    ex_data = text
    dataList = list(map(lambda x: x.split('\t'),ex_data.split('\n')))
    df = pd.DataFrame(dataList[1:],columns = dataList[0])
    df.dropna(inplace=True)
    df['conf'] = pd.to_numeric(df['conf']).astype(int)
    usefulData = df.query('conf >= 10')
    oneimg_data = pd.DataFrame()
    oneimg_data["text"] = usefulData["text"]
    result = pd.concat((result,oneimg_data))
    ax.imshow(image, cmap='gray')
    ax.axis('off')

result.to_csv('result2.csv',index=False)
plt.tight_layout()
plt.show()


def pdf_to_image(pdf_path):
    images = []
    with fitz.open(pdf_path) as pdf_document:
        for page_num in range(len(pdf_document)):
            page = pdf_document.load_page(page_num)
            pix = page.get_pixmap()
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            images.append(img)
    return images


def enhance_image(image):
    # Enhance image contrast
    enhancer = ImageEnhance.Contrast(image)
    enhanced_img = enhancer.enhance(2.0)  # Adjust the enhancement factor as needed
    return enhanced_img


def grayscale(image):
    gray_img = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2GRAY)
    return Image.fromarray(gray_img)

def extract_text_pymupdf(pdf_path):
    text = ""
    with fitz.open(pdf_path) as pdf_document:
        for page_num in range(len(pdf_document)):
            page = pdf_document.load_page(page_num)
            text += page.get_text()
    return text

def extract_text_pymupdf(pdf_path):
    text = ""
    with fitz.open(pdf_path) as pdf_document:
        for page_num in range(len(pdf_document)):
            page = pdf_document.load_page(page_num)
            text += page.get_text()
    return text

def extract_text_pypdf2(pdf_path):
    text = ""
    with open(pdf_path, "rb") as file:
        pdf_reader = PyPDF2.PdfReader(file)
        num_pages = len(pdf_reader.pages)
        for page_num in range(num_pages):
            page = pdf_reader.pages[page_num]
            text += page.extract_text()
    return text

def extract_text_pdfplumber(pdf_path):
    text = ""
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text += page.extract_text()
    return text

def extract_data_from_pdf(pdf_path):
    methods = {
        "PyMuPDF (fitz)": extract_text_pymupdf,
        "PyPDF2": extract_text_pypdf2,
        "pdfplumber": extract_text_pdfplumber,
        "Camelot (Tables)": extract_tables_camelot,
        "OCRmyPDF": extract_text_ocrmypdf

    }
    extracted_data = {}
    for method_name, method_func in methods.items():
        try:
            if method_name == "OCRmyPDF":
                # For OCRmyPDF, convert PDF to images and preprocess
                images_folder = "ocr_images"
                pdf_to_image(pdf_path, images_folder)
                data = method_func(images_folder)
            else:
                data = method_func(pdf_path)
            extracted_data[method_name] = data
        except Exception as e:
            extracted_data[method_name] = f"Error: {str(e)}"
    
    return extracted_data

def extract_tables_camelot(pdf_path):
    tables = camelot.read_pdf(pdf_path, flavor='stream', pages='1-end')
    extracted_tables = []
    for table in tables:
        extracted_tables.append(table.df)
    return extracted_tables


def extract_text_ocrmypdf(pdf_path):
    output_pdf_path = "output_ocrmypdf.pdf"
    os.system(f"ocrmypdf {pdf_path} {output_pdf_path}")
    text = extract_text_pymupdf(output_pdf_path)
    os.remove(output_pdf_path)
    return text

  

pdf_path = "/content/GRADE CARD-2.pdf"
extracted_data = extract_data_from_pdf(pdf_path)

# Display results
for method, data in extracted_data.items():
    print(f"--- {method} ---")
    print(data)
    print("\n")