import { useNavigate, useParams } from "react-router-dom";
import { useEffect, useState, useRef } from "react";
import axios from "axios";
import { Mic, StopCircle, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Layout from "../components/layout/Layout";

// API base URL - centralized for easy configuration
const API_BASE_URL = 'http://127.0.0.1:5000';

const CourseStudy = ({ user }) => {
  const { t, i18n } = useTranslation();
  const [doubt, setDoubt] = useState("");
  const [answer, setAnswer] = useState("");
  const [lectures, setLectures] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedLecture, setSelectedLecture] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [summary, setSummary] = useState("");
  const [showSummary, setShowSummary] = useState(false);
  const [apiStatus, setApiStatus] = useState(null);
  const [videoFile, setVideoFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [videoUploading, setVideoUploading] = useState(false);
  const [detectedLanguage, setDetectedLanguage] = useState("en");
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const videoInputRef = useRef(null);
  
  const navigate = useNavigate();
  const params = useParams();
  const courseId = params.id;
  const token = localStorage.getItem("token");

  // Check API status on component mount
  useEffect(() => {
    const checkApiStatus = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/`);
        setApiStatus(response.data.status === 'online');
      } catch (error) {
        console.error("API server is not responding:", error);
        setApiStatus(false);
      }
    };
    
    checkApiStatus();
  }, []);

  // Function to handle doubt submission
  const handleSubmit = async () => {
    if (!doubt.trim()) return;
    
    try {
      setLoading(true);
      const response = await axios.post(`${API_BASE_URL}/answer_doubt`, {
        doubt,
        transcript: transcript || selectedLecture?.transcript || ""
      });
      setAnswer(response.data.answer);
      // Store detected language for future interactions
      if (response.data.original_language) {
        setDetectedLanguage(response.data.original_language);
      }
      setLoading(false);
    } catch (error) {
      console.error("Error occurred while submitting doubt:", error);
      setLoading(false);
      if (error.response?.status === 404) {
        alert("API endpoint not found. Please check if the backend server is running correctly.");
      }
    }
  };

  // Function to start recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        await processAudioDoubt(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error("Error starting recording:", error);
      alert("Could not access microphone. Please check your browser permissions.");
    }
  };

  // Function to stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  // Function to process the audio doubt
  const processAudioDoubt = async (audioBlob) => {
    try {
      setLoading(true);
      
      // Create form data to send the audio file
      const formData = new FormData();
      formData.append('audio', audioBlob);
      formData.append('transcript', transcript || selectedLecture?.transcript || "");
      
      const response = await axios.post(`${API_BASE_URL}/process_audio_doubt`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      
      // Set the transcribed doubt
      setDoubt(response.data.transcribed_doubt);
      
      // If there's an answer already, set it
      if (response.data.answer) {
        setAnswer(response.data.answer);
      }
      
      // Store detected language
      if (response.data.original_language) {
        setDetectedLanguage(response.data.original_language);
      }
      
      setLoading(false);
    } catch (error) {
      console.error("Error processing audio doubt:", error);
      setLoading(false);
      if (error.response?.status === 404) {
        alert("API endpoint not found. Please check if the backend server is running correctly.");
      }
    }
  };

  // Function to handle video upload
  const handleVideoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setVideoFile(file);
    }
  };

  // Function to process video upload
  const processVideoUpload = async () => {
    if (!videoFile) return;
    
    try {
      setVideoUploading(true);
      
      const formData = new FormData();
      formData.append('video', videoFile);
      formData.append('course_id', courseId);
      formData.append('title', `Lecture ${lectures.length + 1}`);
      formData.append('description', `Uploaded lecture for course ${courseId}`);
      
      const response = await axios.post(`${API_BASE_URL}/transcribe_video`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'token': token
        },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(percentCompleted);
        }
      });
      
      // Add the new lecture to the lectures list
      const newLecture = {
        _id: response.data.lecture._id || Date.now().toString(),
        title: `Lecture ${lectures.length + 1}`,
        description: `Uploaded lecture for course ${courseId}`,
        video: URL.createObjectURL(videoFile),
        transcript: response.data.transcript
      };
      
      const updatedLectures = [...lectures, newLecture];
      setLectures(updatedLectures);
      setSelectedLecture(newLecture);
      setTranscript(response.data.transcript);
      
      // Reset upload state
      setVideoFile(null);
      setUploadProgress(0);
      setVideoUploading(false);
      
      // Reset form
      if (videoInputRef.current) {
        videoInputRef.current.value = "";
      }
      
    } catch (error) {
      console.error("Error processing video:", error);
      setVideoUploading(false);
      if (error.response?.status === 404) {
        alert("API endpoint not found. Please check if the backend server is running correctly.");
      }
    }
  };

  // Function to generate summary of the lecture
  const generateSummary = async () => {
    if (!transcript && !selectedLecture?.transcript) return;
    
    try {
      setLoading(true);
      const response = await axios.post(`${API_BASE_URL}/summarize`, {
        transcript: transcript || selectedLecture?.transcript,
        target_lang: detectedLanguage // Use detected language instead of i18n language
      });
      setSummary(response.data.summary);
      setShowSummary(true);
      setLoading(false);
    } catch (error) {
      console.error("Error generating summary:", error);
      setLoading(false);
      if (error.response?.status === 404) {
        alert("API endpoint not found. Please check if the backend server is running correctly.");
      }
    }
  };

  // Effect to redirect if user doesn't have access
  useEffect(() => {
    if (user && user.role !== "admin" && !user.subscription?.includes(params.id)) {
      navigate("/");
    }
  }, [user, params.id, navigate]);

  // Effect to fetch lectures
  useEffect(() => {
    const fetchLectures = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/api/v1/lectures/${courseId}`, {
          headers: {
            token: token
          },
        });
        const fetchedLectures = response.data.lectures;
        setLectures(fetchedLectures);
        
        if (fetchedLectures && fetchedLectures.length > 0) {
          setSelectedLecture(fetchedLectures[0]);
          
          // If the lecture has a transcript, set it
          if (fetchedLectures[0]?.transcript) {
            setTranscript(fetchedLectures[0].transcript);
          }
        }
      } catch (error) {
        console.error("Error fetching lectures:", error);
      }
    };

    if (token) fetchLectures();
  }, [courseId, token]);

  // Effect to update transcript when selected lecture changes
  useEffect(() => {
    if (selectedLecture?.transcript) {
      setTranscript(selectedLecture.transcript);
      // Reset summary when changing lectures
      setSummary("");
      setShowSummary(false);
      // Reset answer when changing lectures
      setAnswer("");
      setDoubt("");
    }
  }, [selectedLecture]);

  // Language detection for placeholders
  const getPlaceholder = () => {
    const langPhrases = {
      'hi': 'अपना प्रश्न पूछें',
      'ta': 'உங்கள் சந்தேகத்தைக் கேளுங்கள்',
      'te': 'మీ సందేహాన్ని అడగండి',
      'kn': 'ನಿಮ್ಮ ಅನುಮಾನವನ್ನು ಕೇಳಿ',
      'ml': 'നിങ്ങളുടെ സംശയം ചോദിക്കുക',
      'bn': 'আপনার সন্দেহ জিজ্ঞাসা করুন',
      'pa': 'ਆਪਣਾ ਸ਼ੱਕ ਪੁੱਛੋ',
      'gu': 'તમારી શંકા પૂછો',
      'mr': 'तुमची शंका विचारा',
      'or': 'ଆପଣଙ୍କ ସନ୍ଦେହ ପଚାରନ୍ତୁ',
      'en': 'Ask your doubt'
    };
    
    return langPhrases[detectedLanguage] || t('askYourDoubt');
  };

  // Get appropriate button text based on detected language
  const getSubmitText = () => {
    const submitPhrases = {
      'hi': 'सबमिट करें',
      'ta': 'சமர்ப்பிக்கவும்',
      'te': 'సమర్పించండి',
      'kn': 'ಸಲ್ಲಿಸು',
      'ml': 'സമർപ്പിക്കുക',
      'bn': 'জমা দিন',
      'pa': 'ਜਮ੍ਹਾਂ ਕਰੋ',
      'gu': 'સબમિટ કરો',
      'mr': 'सबमिट करा',
      'or': 'ଦାଖଲ କରନ୍ତୁ',
      'en': 'Submit'
    };
    
    return loading ? t('processing') : (submitPhrases[detectedLanguage] || t('submit'));
  };
  
  const getAnswerText = () => {
    const answerPhrases = {
      'hi': 'उत्तर',
      'ta': 'பதில்',
      'te': 'జవాబు',
      'kn': 'ಉತ್ತರ',
      'ml': 'ഉത്തരം',
      'bn': 'উত্তর',
      'pa': 'ਜਵਾਬ',
      'gu': 'જવાબ',
      'mr': 'उत्तर',
      'or': 'ଉତ୍ତର',
      'en': 'Answer'
    };
    
    return answerPhrases[detectedLanguage] || t('answer');
  };

  if (apiStatus === false) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-4">
            <p className="font-bold">AI Server Not Available</p>
            <p>The AI backend server is not responding. Please check that it's running at {API_BASE_URL}</p>
          </div>
          <button 
            onClick={() => window.location.reload()} 
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          >
            Retry Connection
          </button>
        </div>
      </Layout>
    );
  }

  // Empty state with video upload option
  if (lectures.length === 0) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
          <div className="bg-white p-6 rounded-lg shadow-md max-w-md w-full">
            <h1 className="text-2xl font-bold mb-4">{t('No Lectures')}</h1>
            <p className="text-gray-600 mb-6">No lectures found for this course. Upload your first video lecture.</p>
            
            <div className="flex flex-col">
              <input
                type="file"
                ref={videoInputRef}
                accept="video/*"
                onChange={handleVideoUpload}
                className="mb-4"
              />
              
              {videoFile && (
                <div className="mb-4">
                  <p className="text-sm text-gray-700">Selected: {videoFile.name}</p>
                  
                  {videoUploading ? (
                    <div className="w-full bg-gray-200 rounded-full h-2.5 mt-2">
                      <div 
                        className="bg-blue-600 h-2.5 rounded-full" 
                        style={{ width: `${uploadProgress}%` }}
                      ></div>
                    </div>
                  ) : (
                    <button
                      onClick={processVideoUpload}
                      className="mt-2 bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 flex items-center"
                    >
                      <Upload className="mr-2" size={16} />
                      Upload & Transcribe
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  // Regular lecture view
  return (
    <Layout>
      <div className="flex flex-col min-h-screen">
        <div className="flex flex-col lg:flex-row flex-1">
          <div className="flex-1 bg-gray-100 p-4">
            <div className="flex justify-between items-center mb-4">
              <h1 className="text-2xl font-bold">{t('courseLectures')}</h1>
              
              {/* Video Upload Button */}
              <div className="flex items-center">
                <input
                  type="file"
                  ref={videoInputRef}
                  id="video-upload"
                  accept="video/*"
                  onChange={handleVideoUpload}
                  className="hidden"
                />
                <label 
                  htmlFor="video-upload" 
                  className="cursor-pointer bg-purple-400 text-white px-4 py-2 rounded hover:bg-purple-500 flex items-center"
                >
                  <Upload size={16} className="mr-2" />
                  Upload Video
                </label>
              </div>
            </div>
            
            {/* Video Upload Progress */}
            {videoFile && (
              <div className="mb-4 p-3 bg-white rounded-lg shadow">
                <p className="text-sm font-medium">Selected: {videoFile.name}</p>
                
                {videoUploading ? (
                  <div className="mt-2">
                    <div className="flex justify-between mb-1">
                      <span className="text-xs font-medium">Uploading: {uploadProgress}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-blue-600 h-2 rounded-full" 
                        style={{ width: `${uploadProgress}%` }}
                      ></div>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={processVideoUpload}
                    className="mt-2 bg-green-500 text-white px-3 py-1 rounded text-sm hover:bg-green-600"
                  >
                    Upload & Transcribe
                  </button>
                )}
              </div>
            )}
            
            <div className="mb-4">
              <h2 className="text-xl font-semibold">{selectedLecture?.title || ""}</h2>
              <p className="text-gray-600 mb-2">{selectedLecture?.description || ""}</p>
            </div>
            <div className="w-full h-96 bg-black">
              {selectedLecture?.video && (
                <video src={selectedLecture.video} controls className="w-full h-full object-cover" />
              )}
            </div>
            
            {/* Summary Button */}
            <div className="mt-4">
              <button 
                onClick={generateSummary}
                className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                disabled={loading || !selectedLecture?.transcript}
              >
                {detectedLanguage === 'en' ? t('generateSummary') : (
                  {
                    'hi': 'सारांश बनाएं',
                    'ta': 'சுருக்கத்தை உருவாக்கவும்',
                    'te': 'సారాంశాన్ని రూపొందించండి',
                    'kn': 'ಸಾರಾಂಶವನ್ನು ರಚಿಸಿ',
                    'ml': 'സംഗ്രഹം സൃഷ്ടിക്കുക',
                    'bn': 'সারাংশ তৈরি করুন',
                    'pa': 'ਸੰਖੇਪ ਬਣਾਓ',
                    'gu': 'સારાંશ બનાવો',
                    'mr': 'सारांश तयार करा',
                    'or': 'ସାରାଂଶ ସୃଷ୍ଟି କରନ୍ତୁ',
                  }[detectedLanguage] || t('generateSummary')
                )}
              </button>
              
              {/* Show Summary */}
              {showSummary && summary && (
                <div className="mt-4 p-4 bg-white rounded-lg shadow">
                  <h3 className="text-xl font-semibold mb-2">
                    {detectedLanguage === 'en' ? t('lectureOverview') : (
                      {
                        'hi': 'व्याख्यान सारांश',
                        'ta': 'விரிவுரை மேலோட்டம்',
                        'te': 'ఉపన్యాసం సారాంశం',
                        'kn': 'ಉಪನ್ಯಾಸ ವಿಹಂಗಾವಲೋಕನ',
                        'ml': 'പ്രഭാഷണ അവലോകനം',
                        'bn': 'লেকচার সারসংক্ষেপ',
                        'pa': 'ਲੈਕਚਰ ਸੰਖੇਪ',
                        'gu': 'વ્યાખ્યાન ઝલક',
                        'mr': 'व्याख्यान आढावा',
                        'or': 'ଲେକଚର ସାରାଂଶ',
                      }[detectedLanguage] || t('lectureOverview')
                    )}
                  </h3>
                  <p>{summary}</p>
                </div>
              )}
            </div>
          </div>
          
          <div className="w-full lg:w-1/3 bg-white border-l border-gray-200 overflow-y-auto">
            <h2 className="text-xl font-semibold p-4 border-b border-gray-200">
              {detectedLanguage === 'en' ? t('otherLectures') : (
                {
                  'hi': 'अन्य व्याख्यान',
                  'ta': 'மற்ற விரிவுரைகள்',
                  'te': 'ఇతర ఉపన్యాసాలు',
                  'kn': 'ಇತರ ಉಪನ್ಯಾಸಗಳು',
                  'ml': 'മറ്റ് പ്രഭാഷണങ്ങൾ',
                  'bn': 'অন্যান্য লেকচার',
                  'pa': 'ਹੋਰ ਲੈਕਚਰ',
                  'gu': 'અન્ય વ્યાખ્યાનો',
                  'mr': 'इतर व्याख्याने',
                  'or': 'ଅନ୍ୟ ଲେକଚର',
                }[detectedLanguage] || t('otherLectures')
              )}
            </h2>
            <ul>
              {lectures.map((lecture) => (
                <li
                  key={lecture._id}
                  onClick={() => setSelectedLecture(lecture)}
                  className={`cursor-pointer p-4 border-b border-gray-200 hover:bg-gray-100 ${
                    selectedLecture?._id === lecture._id ? "bg-gray-200" : ""
                  }`}
                >
                  <h3 className="text-lg font-semibold">{lecture.title}</h3>
                  <p className="text-gray-600 text-sm">{lecture.description}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-8 px-4 pb-8">
          <h2 className="text-2xl mb-2">
            {detectedLanguage === 'en' ? t('anyDoubts') : (
              {
                'hi': 'कोई प्रश्न हैं?',
                'ta': 'ஏதேனும் சந்தேகங்கள்?',
                'te': 'ఏవైనా సందేహాలు?',
                'kn': 'ಯಾವುದೇ ಸಂದೇಹಗಳು?',
                'ml': 'എന്തെങ്കിലും സംശയങ്ങൾ?',
                'bn': 'কোন প্রশ্ন আছে?',
                'pa': 'ਕੋਈ ਸ਼ੱਕ ਹੈ?',
                'gu': 'કોઈ શંકા છે?',
                'mr': 'काही शंका आहेत?',
                'or': 'କିଛି ସନ୍ଦେହ?',
              }[detectedLanguage] || t('anyDoubts')
            )}
          </h2>
          <div className="mb-4 flex items-center w-full max-w-[700px]">
            <input
              type="text"
              placeholder={getPlaceholder()}
              className="flex-1 px-3 py-2 border rounded-lg bg-gray-200 focus:border-blue-500 focus:outline-none"
              value={doubt}
              onChange={(e) => setDoubt(e.target.value)}
            />
            <button 
              className="ml-2 text-purple-500 cursor-pointer"
              onClick={isRecording ? stopRecording : startRecording}
              title={isRecording ? t('stopRecording') : t('startRecording')}
            >
              {isRecording ? <StopCircle className="text-red-500" /> : <Mic />}
            </button>
          </div>
          
          <button 
            className="p-2 bg-purple-400 px-4 mt-2 text-white rounded hover:bg-purple-500 disabled:opacity-50"
            onClick={handleSubmit}
            disabled={loading || !doubt.trim()}
          >
            {getSubmitText()}
          </button>

          {loading && (
            <p className="mt-2 text-gray-600">
              {detectedLanguage === 'en' ? t('generatingAnswer') : (
                {
                  'hi': 'उत्तर तैयार किया जा रहा है...',
                  'ta': 'பதில் உருவாக்கப்படுகிறது...',
                  'te': 'సమాధానం తయారవుతోంది...',
                  'kn': 'ಉತ್ತರವನ್ನು ರಚಿಸಲಾಗುತ್ತಿದೆ...',
                  'ml': 'ഉത്തരം സൃഷ്ടിക്കുന്നു...',
                  'bn': 'উত্তর তৈরি করা হচ্ছে...',
                  'pa': 'ਜਵਾਬ ਤਿਆਰ ਕੀਤਾ ਜਾ ਰਿਹਾ ਹੈ...',
                  'gu': 'જવાબ બનાવવામાં આવી રહ્યો છે...',
                  'mr': 'उत्तर तयार केले जात आहे...',
                  'or': 'ଉତ୍ତର ସୃଷ୍ଟି କରୁଛି...',
                }[detectedLanguage] || t('generatingAnswer')
              )}
            </p>
          )}
          
          {answer && (
            <div className="mt-4 p-4 bg-white rounded-lg shadow">
              <p className="font-bold">{getAnswerText()}</p>
              <p className="pb-6">{answer}</p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default CourseStudy;