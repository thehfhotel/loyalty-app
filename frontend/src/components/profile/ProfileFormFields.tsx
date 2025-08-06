import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FiUser, FiBriefcase, FiHeart, FiCalendar } from 'react-icons/fi';
import { UseFormRegister, FieldErrors } from 'react-hook-form';
import { getInterestOptions } from '../../utils/interestUtils';

interface ProfileFormFieldsProps {
  register: UseFormRegister<any>;
  errors: FieldErrors<any>;
  showRequiredAsterisk?: boolean;
  isModal?: boolean;
}

export function GenderField({ register, errors, showRequiredAsterisk = false, isModal = false }: ProfileFormFieldsProps) {
  const { t } = useTranslation();
  const [customGender, setCustomGender] = useState('');
  const [selectedGender, setSelectedGender] = useState('');

  const fieldClasses = isModal 
    ? "mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-gray-900 bg-white"
    : "appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm";

  const handleGenderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setSelectedGender(value);
    if (value !== 'other') {
      setCustomGender('');
    }
    // Use the custom gender text if 'other' is selected and custom text is provided
    const finalValue = value === 'other' && customGender ? customGender : value;
    // Trigger the register onChange
    register('gender').onChange(e);
  };

  const handleCustomGenderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const customValue = e.target.value;
    setCustomGender(customValue);
    // Update the actual form field with custom value
    const genderInput = document.getElementById('gender') as HTMLSelectElement;
    if (genderInput) {
      genderInput.value = customValue || 'other';
      genderInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  return (
    <div>
      <label htmlFor="gender" className="block text-sm font-medium text-gray-700">
        {!isModal && <FiUser className="inline h-4 w-4 mr-2" />}
        {t('profile.gender')} {showRequiredAsterisk && '*'}
      </label>
      {isModal ? (
        <div className="mt-1">
          <select
            id="gender"
            {...register('gender')}
            onChange={handleGenderChange}
            className={fieldClasses}
          >
            <option value="" className="text-gray-500">{t('profile.selectGender')}</option>
            <option value="male" className="text-gray-900">{t('profile.male')}</option>
            <option value="female" className="text-gray-900">{t('profile.female')}</option>
            <option value="other" className="text-gray-900">{t('profile.other')}</option>
            <option value="prefer_not_to_say" className="text-gray-900">{t('profile.preferNotToSay')}</option>
          </select>
          
          {selectedGender === 'other' && (
            <div className="mt-2">
              <input
                type="text"
                placeholder="Please specify"
                value={customGender}
                onChange={handleCustomGenderChange}
                className={fieldClasses}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="mt-1">
          <select
            id="gender"
            {...register('gender')}
            className={fieldClasses}
          >
            <option value="">{t('profile.selectGender')}</option>
            <option value="male">{t('profile.male')}</option>
            <option value="female">{t('profile.female')}</option>
            <option value="other">{t('profile.other')}</option>
            <option value="prefer_not_to_say">{t('profile.preferNotToSay')}</option>
          </select>
        </div>
      )}
      
      {errors.gender && (
        <p className="mt-1 text-sm text-red-600">{String(errors.gender.message) || 'Invalid value'}</p>
      )}
    </div>
  );
}

export function OccupationField({ register, errors, showRequiredAsterisk = false, isModal = false }: ProfileFormFieldsProps) {
  const { t } = useTranslation();

  const fieldClasses = isModal 
    ? "mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-gray-900 bg-white"
    : "appearance-none block w-full px-3 py-2 pl-10 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm";

  return (
    <div>
      <label htmlFor="occupation" className="block text-sm font-medium text-gray-700">
        <FiBriefcase className="inline h-4 w-4 mr-2" />
        {t('profile.occupation')} {showRequiredAsterisk && '*'}
      </label>
      <div className={isModal ? "" : "mt-1 relative"}>
        {!isModal && (
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <FiBriefcase className="h-5 w-5 text-gray-400" />
          </div>
        )}
        <select
          id="occupation"
          {...register('occupation')}
          className={fieldClasses}
        >
          <option value="" className="text-gray-500">{t('profile.selectOccupation')}</option>
          <option value="student" className="text-gray-900">{t('profile.occupations.student')}</option>
          <option value="business_owner" className="text-gray-900">{t('profile.occupations.business_owner')}</option>
          <option value="employee" className="text-gray-900">{t('profile.occupations.employee')}</option>
          <option value="freelancer" className="text-gray-900">{t('profile.occupations.freelancer')}</option>
          <option value="consultant" className="text-gray-900">{t('profile.occupations.consultant')}</option>
          <option value="teacher" className="text-gray-900">{t('profile.occupations.teacher')}</option>
          <option value="healthcare" className="text-gray-900">{t('profile.occupations.healthcare')}</option>
          <option value="engineer" className="text-gray-900">{t('profile.occupations.engineer')}</option>
          <option value="artist" className="text-gray-900">{t('profile.occupations.artist')}</option>
          <option value="sales" className="text-gray-900">{t('profile.occupations.sales')}</option>
          <option value="manager" className="text-gray-900">{t('profile.occupations.manager')}</option>
          <option value="retired" className="text-gray-900">{t('profile.occupations.retired')}</option>
          <option value="other" className="text-gray-900">{t('profile.occupations.other')}</option>
        </select>
      </div>
      {errors.occupation && (
        <p className="mt-1 text-sm text-red-600">{String(errors.occupation.message) || 'Invalid value'}</p>
      )}
    </div>
  );
}

export function InterestsField({ register, errors, showRequiredAsterisk = false, isModal = false }: ProfileFormFieldsProps) {
  const { t } = useTranslation();
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  
  // Create unique field ID to prevent conflicts between modal and profile page
  const fieldId = isModal ? 'interests-modal' : 'interests';

  // Get translated interest options
  const interestOptions = getInterestOptions(t);

  const handleInterestToggle = (displayName: string) => {
    const newInterests = selectedInterests.includes(displayName)
      ? selectedInterests.filter(i => i !== displayName)
      : [...selectedInterests, displayName];
    
    setSelectedInterests(newInterests);
    
    // Update the hidden input field (store English display names)
    const hiddenInput = document.getElementById(fieldId) as HTMLInputElement;
    if (hiddenInput) {
      hiddenInput.value = newInterests.join(', ');
      hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
      hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  // Initialize selected interests from existing value
  React.useEffect(() => {
    const hiddenInput = document.getElementById(fieldId) as HTMLInputElement;
    if (hiddenInput && hiddenInput.value) {
      const existing = hiddenInput.value.split(', ').filter(i => i.trim());
      setSelectedInterests(existing);
    } else {
      // Clear selections if no value
      setSelectedInterests([]);
    }
  }, []);
  
  // Watch for external value changes (form reset)
  React.useEffect(() => {
    const hiddenInput = document.getElementById(fieldId) as HTMLInputElement;
    if (hiddenInput) {
      const handleValueChange = () => {
        if (hiddenInput.value) {
          const existing = hiddenInput.value.split(', ').filter(i => i.trim());
          setSelectedInterests(existing);
        } else {
          setSelectedInterests([]);
        }
      };
      
      // Add event listeners for value changes
      hiddenInput.addEventListener('input', handleValueChange);
      hiddenInput.addEventListener('change', handleValueChange);
      
      return () => {
        hiddenInput.removeEventListener('input', handleValueChange);
        hiddenInput.removeEventListener('change', handleValueChange);
      };
    }
  }, [register]);

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-3">
        {!isModal && <FiHeart className="inline h-5 w-5 mr-2 text-gray-400" />}
        {isModal && <FiHeart className="inline h-4 w-4 mr-2" />}
        {t('profile.interests')} {showRequiredAsterisk && '*'}
      </label>
      
      {/* Open Grid Layout - Same for both modal and profile page */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-3">
        {interestOptions.map((option) => (
          <label 
            key={option.key}
            className={`flex items-center space-x-2 p-2 rounded-lg border cursor-pointer transition-all ${
              selectedInterests.includes(option.displayName)
                ? 'bg-blue-50 border-blue-300 text-blue-800' 
                : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300'
            }`}
          >
            <input
              type="checkbox"
              checked={selectedInterests.includes(option.displayName)}
              onChange={() => handleInterestToggle(option.displayName)}
              className={`rounded border-gray-300 focus:ring-2 ${
                isModal 
                  ? 'text-blue-600 focus:ring-blue-500' 
                  : 'text-primary-600 focus:ring-primary-500'
              }`}
            />
            <span className="text-xs font-medium leading-tight">{option.translatedName}</span>
          </label>
        ))}
      </div>
      
      {/* Hidden input for form registration */}
      <input
        type="hidden"
        id={fieldId}
        {...register('interests')}
      />
      
      <p className="text-xs text-gray-500 mb-2">
        {t('profile.selectInterestsHelp', 'Select all interests that match your preferences')}
      </p>
      
      {selectedInterests.length > 0 && (
        <div className="mb-2">
          <p className="text-xs text-gray-600 mb-1">{t('profile.selectedInterests', 'Selected')} ({selectedInterests.length}):</p>
          <div className="flex flex-wrap gap-1">
            {selectedInterests.map((interest, index) => {
              // Find the translated name for this interest
              const option = interestOptions.find(opt => opt.displayName === interest);
              const displayText = option ? option.translatedName : interest;
              
              return (
                <span 
                  key={index}
                  className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
                >
                  {displayText}
                  <button
                    type="button"
                    onClick={() => handleInterestToggle(interest)}
                    className="ml-1 text-blue-600 hover:text-blue-800 focus:outline-none"
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      )}
      
      {errors.interests && (
        <p className="mt-1 text-sm text-red-600">{String(errors.interests.message) || 'Invalid value'}</p>
      )}
    </div>
  );
}

export function DateOfBirthField({ register, errors, showRequiredAsterisk = false, isModal = false }: ProfileFormFieldsProps) {
  const { t } = useTranslation();

  const fieldClasses = isModal 
    ? "mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-gray-900"
    : "appearance-none block w-full px-3 py-2 pl-10 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm";

  return (
    <div>
      <label htmlFor="dateOfBirth" className="block text-sm font-medium text-gray-700">
        <FiCalendar className="inline h-4 w-4 mr-2" />
        {t('profile.dateOfBirth')} {showRequiredAsterisk && '*'}
      </label>
      <div className={isModal ? "" : "mt-1 relative"}>
        {!isModal && (
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <FiCalendar className="h-5 w-5 text-gray-400" />
          </div>
        )}
        <input
          type="date"
          id="dateOfBirth"
          {...register('dateOfBirth')}
          className={fieldClasses}
          style={{ colorScheme: 'light' }}
        />
      </div>
      {errors.dateOfBirth && (
        <p className="mt-1 text-sm text-red-600">{String(errors.dateOfBirth.message) || 'Invalid value'}</p>
      )}
    </div>
  );
}