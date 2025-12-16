import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FiUser, FiBriefcase, FiCalendar } from 'react-icons/fi';
import { UseFormRegister, FieldErrors } from 'react-hook-form';

export interface ProfileFormData {
  firstName: string;
  lastName?: string;
  phone?: string;
  dateOfBirth?: string;
  gender?: string;
  occupation?: string;
  email?: string;
}

interface ProfileFormFieldsProps {
  register: UseFormRegister<ProfileFormData>;
  errors: FieldErrors<ProfileFormData>;
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