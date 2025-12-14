/* eslint-disable no-console -- Debug tool requires console logging for diagnostics */
import React, { useState } from 'react';
import { surveyService } from '../../services/surveyService';
import { CreateSurveyRequest } from '../../types/survey';
import toast from 'react-hot-toast';

/**
 * Thai Survey Debug Page
 *
 * This component provides a dedicated interface for testing Thai language
 * survey creation to debug the 400 error. It includes detailed logging
 * and error capture specifically for Thai content validation issues.
 */
const ThaiSurveyDebug: React.FC = () => {
  const [isCreating, setIsCreating] = useState(false);
  const [lastError, setLastError] = useState<Error | null>(null);

  // Pre-filled Thai survey data matching the test scenario
  const [surveyData, setSurveyData] = useState<CreateSurveyRequest>({
    title: "ความพึงพอใจของลูกค้า", // "Customer Satisfaction" in Thai
    description: "กรุณาช่วยเราปรับปรุงบริการ", // "Please help us improve our service" in Thai
    questions: [
      {
        id: "q_thai_001",
        type: "single_choice",
        text: "คุณพอใจกับบริการไหม?", // "Are you satisfied with the service?" in Thai
        required: true,
        order: 1,
        options: [
          {
            id: "opt_thai_001",
            text: "พอใจมาก", // "Very satisfied" in Thai
            value: "very_satisfied"
          },
          {
            id: "opt_thai_002", 
            text: "พอใจ", // "Satisfied" in Thai
            value: "satisfied"
          }
        ]
      }
    ],
    target_segment: {},
    access_type: "public"
  });

  const handleCreateSurvey = async () => {
    setIsCreating(true);
    setLastError(null);

    try {
      console.log('🧪 THAI SURVEY DEBUG - Creating survey...');
      console.log('Survey data:', JSON.stringify(surveyData, null, 2));
      
      // Analyze encoding before sending
      console.log('📊 Encoding analysis:');
      console.log('Title:', {
        text: surveyData.title,
        length: surveyData.title.length,
        bytes: new TextEncoder().encode(surveyData.title).length,
        charCodes: Array.from(surveyData.title).map(char => char.charCodeAt(0))
      });
      
      console.log('Description:', {
        text: surveyData.description,
        length: surveyData.description?.length ?? 0,
        bytes: surveyData.description ? new TextEncoder().encode(surveyData.description).length : 0
      });

      surveyData.questions.forEach((q, i) => {
        console.log(`Question ${i + 1}:`, {
          text: q.text,
          length: q.text.length,
          bytes: new TextEncoder().encode(q.text).length
        });
        
        q.options?.forEach((opt, j) => {
          console.log(`  Option ${j + 1}:`, {
            text: opt.text,
            length: opt.text.length,
            bytes: new TextEncoder().encode(opt.text).length
          });
        });
      });

      const result = await surveyService.createSurvey(surveyData);
      console.log('✅ Survey created successfully:', result);
      toast.success('Thai survey created successfully!');

    } catch (error) {
      console.error('❌ THAI SURVEY CREATION ERROR:', error);
      setLastError(error instanceof Error ? error : new Error(String(error)));

      const errorMessage = error instanceof Error && 'response' in error
        ? (error as { response?: { data?: { message?: string } } }).response?.data?.message ?? (error as Error).message
        : 'Unknown error';
      toast.error(`Failed to create survey: ${errorMessage}`);
    } finally {
      setIsCreating(false);
    }
  };

  // Type guard for axios-like error
  const getAxiosError = (error: Error | null) => {
    if (!error) {return null;}
    if ('response' in error) {
      return error as unknown as { response?: { status?: number; statusText?: string; data?: Record<string, unknown> }; message?: string };
    }
    return { message: error.message };
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">
            🧪 Thai Survey Debug Tool
          </h1>
          
          <div className="mb-6 p-4 bg-blue-50 rounded-lg">
            <h2 className="text-lg font-semibold text-blue-900 mb-2">Purpose</h2>
            <p className="text-blue-800">
              This page is designed to debug the 400 error when creating surveys with Thai language content.
              It includes detailed logging and error capture to identify validation issues.
            </p>
          </div>

          {/* Survey Data Preview */}
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">📋 Survey Data</h2>
            
            <div className="space-y-4">
              {/* Title */}
              <div className="border rounded p-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Title (Thai)
                </label>
                <input
                  type="text"
                  value={surveyData.title}
                  onChange={(e) => setSurveyData({...surveyData, title: e.target.value})}
                  className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                />
                <div className="mt-2 text-xs text-gray-600">
                  <div>Length: {surveyData.title.length} chars</div>
                  <div>Bytes: {new TextEncoder().encode(surveyData.title).length}</div>
                  <div>Has Thai: {/[\u0E00-\u0E7F]/.test(surveyData.title) ? 'Yes' : 'No'}</div>
                </div>
              </div>

              {/* Description */}
              <div className="border rounded p-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description (Thai)
                </label>
                <textarea
                  value={surveyData.description}
                  onChange={(e) => setSurveyData({...surveyData, description: e.target.value})}
                  className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                  rows={3}
                />
                <div className="mt-2 text-xs text-gray-600">
                  <div>Length: {surveyData.description?.length ?? 0} chars</div>
                  <div>Bytes: {surveyData.description ? new TextEncoder().encode(surveyData.description).length : 0}</div>
                </div>
              </div>

              {/* Question */}
              <div className="border rounded p-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Question Text (Thai)
                </label>
                <input
                  type="text"
                  value={surveyData.questions[0]?.text ?? ''}
                  onChange={(e) => {
                    const updated = {...surveyData};
                    if (updated.questions[0]) {
                      updated.questions[0].text = e.target.value;
                      setSurveyData(updated);
                    }
                  }}
                  className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                />
                <div className="mt-2 text-xs text-gray-600">
                  <div>Length: {surveyData.questions[0]?.text.length ?? 0} chars</div>
                  <div>Bytes: {surveyData.questions[0]?.text ? new TextEncoder().encode(surveyData.questions[0].text).length : 0}</div>
                </div>
              </div>

              {/* Options */}
              <div className="border rounded p-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Options (Thai)
                </label>
                {surveyData.questions[0]?.options?.map((option, index) => (
                  <div key={option.id} className="mb-2">
                    <input
                      type="text"
                      value={option.text}
                      onChange={(e) => {
                        const updated = {...surveyData};
                        const firstQuestion = updated.questions[0];
                        if (firstQuestion?.options?.[index]) {
                          firstQuestion.options[index].text = e.target.value;
                          setSurveyData(updated);
                        }
                      }}
                      className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                      placeholder={`Option ${index + 1}`}
                    />
                    <div className="text-xs text-gray-600 mt-1">
                      Length: {option.text.length} chars, Bytes: {new TextEncoder().encode(option.text).length}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="mb-6">
            <button
              onClick={handleCreateSurvey}
              disabled={isCreating}
              className="bg-blue-600 text-white px-6 py-3 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
            >
              {isCreating && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />}
              {isCreating ? 'Creating Survey...' : '🚀 Create Thai Survey'}
            </button>
          </div>

          {/* Error Display */}
          {lastError && (() => {
            const err = getAxiosError(lastError);
            if (!err) {return null as React.ReactElement | null;}

            return (
              <div className="mb-6" key="error-display">
                <h2 className="text-lg font-semibold text-red-900 mb-4">❌ Last Error</h2>
                <div className="bg-red-50 border border-red-200 rounded p-4">
                  <div className="mb-4">
                    <strong>Status:</strong> {err.response?.status} {err.response?.statusText}
                  </div>

                  <div className="mb-4">
                    <strong>Message:</strong> {(err.response?.data?.message as string) ?? err.message ?? 'Unknown error'}
                  </div>

                  {err.response?.data?.validationErrors ? (
                    <div className="mb-4">
                      <strong>Validation Errors:</strong>
                      <pre className="text-xs mt-2 bg-white p-2 rounded border overflow-auto max-h-40">
                        {String(JSON.stringify(err.response.data.validationErrors, null, 2))}
                      </pre>
                    </div>
                  ) : null}

                  {err.response?.data?.receivedData ? (
                    <div className="mb-4">
                      <strong>Backend Received:</strong>
                      <pre className="text-xs mt-2 bg-white p-2 rounded border overflow-auto max-h-40">
                        {String(JSON.stringify(err.response.data.receivedData, null, 2))}
                      </pre>
                    </div>
                  ) : null}

                  <div>
                    <strong>Full Error:</strong>
                    <pre className="text-xs mt-2 bg-white p-2 rounded border overflow-auto max-h-60">
                      {String(JSON.stringify(err.response?.data ?? err, null, 2))}
                    </pre>
                  </div>
                </div>
              </div>
            ) as React.ReactElement | null;
          })() as React.ReactElement | null}

          {/* Instructions */}
          <div className="bg-yellow-50 border border-yellow-200 rounded p-4">
            <h2 className="text-lg font-semibold text-yellow-900 mb-2">📝 Instructions</h2>
            <ol className="list-decimal list-inside text-yellow-800 space-y-1">
              <li>Open browser dev tools console for detailed logging</li>
              <li>Click &quot;Create Thai Survey&quot; to reproduce the 400 error</li>
              <li>Check the console for detailed request/response data</li>
              <li>Check the &quot;Last Error&quot; section above for validation details</li>
              <li>Check backend server logs for additional debugging info</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ThaiSurveyDebug;