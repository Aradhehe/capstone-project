from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import os
import whisper
import torch
from langchain.text_splitter import CharacterTextSplitter
from langchain.vectorstores import FAISS
from langchain_huggingface import HuggingFaceEmbeddings
from langchain.schema import Document
from huggingface_hub import InferenceClient, login
from deep_translator import GoogleTranslator
from langdetect import detect
import uuid
import json

app = Flask(__name__)
CORS(app)

# Configuration
UPLOAD_FOLDER = 'uploads'
LECTURES_DATA_FILE = 'lectures.json'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# === Initialize Models and Tools ===
# Hugging Face Login
login(token="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")

# Load Whisper Model for Transcription
whisper_model = whisper.load_model("base")

# Set Up LLM & Embeddings
repo_id = "mistralai/Mistral-7B-Instruct-v0.3"
client = InferenceClient(model=repo_id)
embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
text_splitter = CharacterTextSplitter(separator="\n", chunk_size=500, chunk_overlap=50)

# === Lecture Management Functions ===
def load_lectures():
    if os.path.exists(LECTURES_DATA_FILE):
        with open(LECTURES_DATA_FILE, 'r') as f:
            return json.load(f)
    return {}

def save_lectures(lectures_data):
    with open(LECTURES_DATA_FILE, 'w') as f:
        json.dump(lectures_data, f)

# === Language Detection and Mapping for Indian Languages ===
def detect_language(text):
    if not text or len(text.strip()) < 5:
        return 'en'  # Default to English for very short text
    
    try:
        # Define common Indian language indicators with more comprehensive character sets
        indian_lang_indicators = {
            'hi': ['अ', 'आ', 'इ', 'ई', 'उ', 'ऊ', 'ए', 'ऐ', 'ओ', 'औ', 'क', 'ख', 'ग'],  # Hindi
            'te': ['అ', 'ఆ', 'ఇ', 'ఈ', 'ఉ', 'ఊ', 'ఎ', 'ఏ', 'ఒ', 'ఓ', 'క', 'ఖ', 'గ'],  # Telugu
            'ta': ['அ', 'ஆ', 'இ', 'ஈ', 'உ', 'ஊ', 'எ', 'ஏ', 'ஒ', 'ஓ', 'க', 'ங', 'ச'],  # Tamil
            'kn': ['ಅ', 'ಆ', 'ಇ', 'ಈ', 'ಉ', 'ಊ', 'ಎ', 'ಏ', 'ಒ', 'ಓ', 'ಕ', 'ಖ', 'ಗ'],  # Kannada
            'ml': ['അ', 'ആ', 'ഇ', 'ഈ', 'ഉ', 'ഊ', 'എ', 'ഏ', 'ഒ', 'ഓ', 'ക', 'ഖ', 'ഗ'],  # Malayalam
            'bn': ['অ', 'আ', 'ই', 'ঈ', 'উ', 'ঊ', 'এ', 'ঐ', 'ও', 'ঔ', 'ক', 'খ', 'গ'],  # Bengali
            'pa': ['ਅ', 'ਆ', 'ਇ', 'ਈ', 'ਉ', 'ਊ', 'ਏ', 'ਐ', 'ਓ', 'ਔ', 'ਕ', 'ਖ', 'ਗ'],  # Punjabi
            'gu': ['અ', 'આ', 'ઇ', 'ઈ', 'ઉ', 'ઊ', 'એ', 'ઍ', 'ઓ', 'ઔ', 'ક', 'ખ', 'ગ'],  # Gujarati
            'or': ['ଅ', 'ଆ', 'ଇ', 'ଈ', 'ଉ', 'ଊ', 'ଏ', 'ଐ', 'ଓ', 'ଔ', 'କ', 'ଖ', 'ଗ'],  # Odia
            'mr': ['अ', 'आ', 'इ', 'ई', 'उ', 'ऊ', 'ए', 'ऐ', 'ओ', 'औ', 'क', 'ख', 'ग'],  # Marathi (similar to Hindi)
        }
        
        # Check for language characters
        for lang, chars in indian_lang_indicators.items():
            for char in chars:
                if char in text:
                    return lang
        
        # If no script match, try langdetect
        detected = detect(text)
        return detected
    except:
        # Fallback to English if detection fails
        return 'en'

# === Translation Functions ===
def translate_to_english(text, source_lang=None):
    if not text:
        return ""
        
    if not source_lang:
        source_lang = detect_language(text)
    
    # If already English, return as is
    if source_lang == 'en':
        return text
    
    try:
        translated = GoogleTranslator(source=source_lang, target='en').translate(text)
        return translated if translated else text
    except Exception as e:
        print(f"Translation error: {e}")
        return text  # Return original if translation fails

def translate_from_english(text, target_lang):
    if not text:
        return ""
        
    # If target is English, return as is
    if target_lang == 'en':
        return text
    
    try:
        translated = GoogleTranslator(source='en', target=target_lang).translate(text)
        return translated if translated else text
    except Exception as e:
        print(f"Translation error: {e}")
        return text  # Return original if translation fails

# === Core Functions ===
def summarize_text(text):
    prompt = f"Summarize the following video transcript in detail:\n{text}\n\nSummary:"
    response = client.text_generation(prompt=prompt, max_new_tokens=200)
    return response.strip()

def process_doubt(user_doubt, text):
    docs = [Document(page_content=text)]
    chunks = text_splitter.split_documents(docs)
    db = FAISS.from_documents(chunks, embeddings)
    relevant_docs = db.similarity_search(user_doubt, k=3)
    context = "\n".join(doc.page_content for doc in relevant_docs)
    prompt = f"Answer the question based on the video content.\nContext: {context}\n\nQuestion: {user_doubt}\nAnswer:"
    response = client.text_generation(prompt=prompt, max_new_tokens=150)
    return response.strip()

# === API Routes ===
# Root route to handle 404 error
@app.route('/')
def index():
    return jsonify({
        'status': 'online',
        'message': 'AI Learning Assistant API is running',
        'endpoints': [
            '/answer_doubt',
            '/process_audio_doubt',
            '/summarize',
            '/transcribe_video',
            '/api/v1/lectures/<course_id>'
        ]
    })

@app.route('/answer_doubt', methods=['POST'])
def answer_doubt():
    data = request.json
    doubt = data.get('doubt', '')
    transcript = data.get('transcript', '')
    
    if not doubt or not transcript:
        return jsonify({'error': 'Doubt or transcript missing'}), 400
    
    try:
        # Detect input language
        detected_lang = detect_language(doubt)
        
        # Translate doubt to English if needed
        if detected_lang != 'en':
            translated_doubt = translate_to_english(doubt, detected_lang)
        else:
            translated_doubt = doubt
        
        # Process doubt in English
        answer_in_english = process_doubt(translated_doubt, transcript)
        
        # Return answer in the detected language
        if detected_lang == 'en':
            final_answer = answer_in_english
        else:
            final_answer = translate_from_english(answer_in_english, detected_lang)
        
        return jsonify({
            'answer': final_answer,
            'original_language': detected_lang
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/process_audio_doubt', methods=['POST'])
def process_audio_doubt():
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400
    
    transcript = request.form.get('transcript', '')
    
    try:
        # Save the audio file temporarily
        audio_file = request.files['audio']
        temp_path = os.path.join(UPLOAD_FOLDER, 'temp_audio.wav')
        audio_file.save(temp_path)
        
        # Transcribe the audio
        audio_result = whisper_model.transcribe(temp_path)
        transcribed_doubt = audio_result['text']
        
        # Clean up
        if os.path.exists(temp_path):
            os.remove(temp_path)
        
        # If we have a transcript, process the doubt
        answer = None
        if transcript:
            # Detect language and translate if needed
            detected_lang = detect_language(transcribed_doubt)
            
            if detected_lang != 'en':
                translated_doubt = translate_to_english(transcribed_doubt, detected_lang)
            else:
                translated_doubt = transcribed_doubt
            
            # Process doubt
            answer_in_english = process_doubt(translated_doubt, transcript)
            
            # Translate answer back to original language
            if detected_lang == 'en':
                answer = answer_in_english
            else:
                answer = translate_from_english(answer_in_english, detected_lang)
        
        return jsonify({
            'transcribed_doubt': transcribed_doubt,
            'answer': answer,
            'original_language': detected_lang if 'detected_lang' in locals() else 'en'
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/summarize', methods=['POST'])
def summarize():
    data = request.json
    transcript = data.get('transcript', '')
    target_lang = data.get('target_lang', 'en')
    
    if not transcript:
        return jsonify({'error': 'Transcript missing'}), 400
    
    try:
        # Generate summary in English
        summary_in_english = summarize_text(transcript)
        
        # Translate summary if needed
        if target_lang == 'en':
            final_summary = summary_in_english
        else:
            final_summary = translate_from_english(summary_in_english, target_lang)
        
        return jsonify({
            'summary': final_summary
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/transcribe_video', methods=['POST'])
def transcribe_video():
    if 'video' not in request.files:
        return jsonify({'error': 'No video file provided'}), 400
    
    try:
        # Get parameters
        video_file = request.files['video']
        course_id = request.form.get('course_id', '')
        title = request.form.get('title', 'Untitled Lecture')
        description = request.form.get('description', 'No description')
        
        # Generate unique ID for video
        video_id = str(uuid.uuid4())
        video_filename = f"{video_id}.mp4"
        video_path = os.path.join(UPLOAD_FOLDER, video_filename)
        
        # Save the video file
        video_file.save(video_path)
        
        # Transcribe the video
        result = whisper_model.transcribe(video_path)
        transcript = result['text']
        
        # Create lecture entry
        lecture = {
            '_id': video_id,
            'title': title,
            'description': description,
            'video': f"/uploads/{video_filename}",
            'transcript': transcript,
            'course_id': course_id
        }
        
        # Add lecture to data store
        lectures_data = load_lectures()
        if course_id not in lectures_data:
            lectures_data[course_id] = []
        lectures_data[course_id].append(lecture)
        save_lectures(lectures_data)
        
        return jsonify({
            'transcript': transcript,
            'lecture': lecture
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/v1/lectures/<course_id>', methods=['GET'])
def get_lectures(course_id):
    token = request.headers.get('token')
    
    if not token:
        return jsonify({'error': 'Authentication required'}), 401
    
    # In a real app, you would validate the token here
    # For now, we'll just check if it exists
    
    try:
        lectures_data = load_lectures()
        lectures = lectures_data.get(course_id, [])
        
        return jsonify({
            'lectures': lectures
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Serve uploaded files
@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)