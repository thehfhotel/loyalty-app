import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, FormField, Input, Modal, Select, Textarea } from '../../components/ui';
import {
  depositLinkService,
  type CreateDepositLinkRequest,
  type DepositLinkRoomType,
  type IssuedDepositLink,
  type Property,
} from '../../services/depositLinkService';
import IssuedDepositLinkPanel from './IssuedDepositLinkPanel';
import { logger } from '../../utils/logger';

/**
 * "Send deposit link" (B1 §3, reception half).
 *
 * Reception has already taken the booking by phone, LINE or at the desk;
 * this modal turns it into a `bookings` row plus one live token. The deposit
 * field is pre-filled with 50% of the total and editable inside [1, total]
 * (owner decision W4) — the override is what the backend writes to the audit
 * row, so it is deliberately a plain number field, not a slider.
 *
 * On success the token is shown exactly once.
 */

const PROPERTIES: Property[] = ['hf', 'hfville'];
const EXPIRY_CHOICES = [24, 48, 72];
const DEFAULT_EXPIRY_HOURS = 48;

/** 50% of the total, rounded half up to 2 dp (owner decision W4). */
function defaultDepositAmount(totalPrice: number): number {
  if (!Number.isFinite(totalPrice) || totalPrice <= 0) {
    return 0;
  }
  return Math.round(totalPrice * 50) / 100;
}

export interface DepositLinkModalProps {
  open: boolean;
  onClose: () => void;
}

export default function DepositLinkModal({ open, onClose }: DepositLinkModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const formId = useId();

  const [property, setProperty] = useState<Property | ''>('');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [guests, setGuests] = useState('1');
  const [roomTypeId, setRoomTypeId] = useState('');
  const [totalPrice, setTotalPrice] = useState('');
  const [amountDueNow, setAmountDueNow] = useState('');
  const [depositTouched, setDepositTouched] = useState(false);
  const [expiresInHours, setExpiresInHours] = useState(DEFAULT_EXPIRY_HOURS);
  const [pmsRef, setPmsRef] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedDepositLink | null>(null);

  const roomTypesQuery = useQuery<DepositLinkRoomType[]>({
    queryKey: ['admin', 'deposit-link', 'room-types'],
    queryFn: () => depositLinkService.listRoomTypes(),
    enabled: open,
  });
  const roomTypes = useMemo(() => roomTypesQuery.data ?? [], [roomTypesQuery.data]);

  // The 50% pre-fill follows the total until reception overrides it; once
  // overridden it stays put, because the override is the whole point.
  useEffect(() => {
    if (depositTouched) {
      return;
    }
    const parsed = Number(totalPrice);
    setAmountDueNow(totalPrice === '' || !Number.isFinite(parsed) ? '' : String(defaultDepositAmount(parsed)));
  }, [totalPrice, depositTouched]);

  const resetForm = useCallback(() => {
    setProperty('');
    setGuestName('');
    setGuestPhone('');
    setCheckIn('');
    setCheckOut('');
    setGuests('1');
    setRoomTypeId('');
    setTotalPrice('');
    setAmountDueNow('');
    setDepositTouched(false);
    setExpiresInHours(DEFAULT_EXPIRY_HOURS);
    setPmsRef('');
    setNote('');
    setError(null);
    setIssued(null);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const createMutation = useMutation({
    mutationFn: (payload: CreateDepositLinkRequest) => depositLinkService.createLink(payload),
    onSuccess: async (link) => {
      setIssued(link);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'deposit-links'] });
    },
    onError: (mutationError: Error) => {
      // Not `mutationError.message || t(...)`: the shared axios instance
      // rejects with a message that is always non-empty and always English
      // (worst case axios's own "Request failed with status code 500"), so
      // that fallback could never fire and reception would read English in a
      // Thai-first form. The raw detail belongs in the log, not on screen.
      logger.error('Deposit link create failed:', mutationError.message);
      setError(t('depositLink.admin.errors.createFailed'));
    },
  });

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const total = Number(totalPrice);
      const deposit = Number(amountDueNow);
      const guestCount = Number(guests);

      if (
        !property ||
        !guestName.trim() ||
        !guestPhone.trim() ||
        !checkIn ||
        !checkOut ||
        !roomTypeId ||
        !Number.isFinite(guestCount) ||
        guestCount < 1
      ) {
        setError(t('depositLink.admin.errors.required'));
        return;
      }
      if (new Date(checkOut).getTime() <= new Date(checkIn).getTime()) {
        setError(t('depositLink.admin.errors.dates'));
        return;
      }
      if (!Number.isFinite(total) || total <= 0) {
        setError(t('depositLink.admin.errors.totalPrice'));
        return;
      }
      if (!Number.isFinite(deposit) || deposit < 1 || deposit > total) {
        setError(t('depositLink.admin.errors.amountDueNow'));
        return;
      }

      setError(null);
      createMutation.mutate({
        property,
        guestName: guestName.trim(),
        guestPhone: guestPhone.trim(),
        checkIn,
        checkOut,
        guests: guestCount,
        roomTypeId,
        totalPrice: total,
        amountDueNow: deposit,
        expiresInHours,
        ...(pmsRef.trim() ? { pmsRef: pmsRef.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
    },
    [
      amountDueNow,
      checkIn,
      checkOut,
      createMutation,
      expiresInHours,
      guestName,
      guestPhone,
      guests,
      note,
      pmsRef,
      property,
      roomTypeId,
      t,
      totalPrice,
    ],
  );

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="lg"
      title={t('depositLink.admin.modalTitle')}
    >
      {issued ? (
        // The actions live inside the panel/form rather than in the Modal's
        // `footer` slot: a submit button outside its own <form> depends on
        // the `form` attribute association, which is exactly the kind of
        // thing that works in a browser and quietly does nothing elsewhere.
        <div className="space-y-4">
          <IssuedDepositLinkPanel link={issued} />
          <div className="flex justify-end">
            <Button type="button" onClick={handleClose}>
              {t('depositLink.admin.issued.done')}
            </Button>
          </div>
        </div>
      ) : (
        <form id={formId} onSubmit={handleSubmit} className="space-y-4">
          <p className="text-caption text-ink-muted">{t('depositLink.admin.modalSubtitle')}</p>

          <FormField label={t('depositLink.admin.form.property')} htmlFor={`${formId}-property`} required>
            <Select
              value={property}
              onChange={(event) => setProperty(event.target.value as Property | '')}
              data-testid="deposit-link-property"
            >
              <option value="">{t('depositLink.admin.form.selectProperty')}</option>
              {PROPERTIES.map((value) => (
                <option key={value} value={value}>
                  {t(`property.${value}`)}
                </option>
              ))}
            </Select>
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('depositLink.admin.form.guestName')} htmlFor={`${formId}-guest-name`} required>
              <Input
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
                data-testid="deposit-link-guest-name"
              />
            </FormField>
            <FormField label={t('depositLink.admin.form.guestPhone')} htmlFor={`${formId}-guest-phone`} required>
              <Input
                type="tel"
                value={guestPhone}
                onChange={(event) => setGuestPhone(event.target.value)}
                data-testid="deposit-link-guest-phone"
              />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label={t('depositLink.admin.form.checkIn')} htmlFor={`${formId}-check-in`} required>
              <Input
                type="date"
                value={checkIn}
                onChange={(event) => setCheckIn(event.target.value)}
                data-testid="deposit-link-check-in"
              />
            </FormField>
            <FormField label={t('depositLink.admin.form.checkOut')} htmlFor={`${formId}-check-out`} required>
              <Input
                type="date"
                value={checkOut}
                onChange={(event) => setCheckOut(event.target.value)}
                data-testid="deposit-link-check-out"
              />
            </FormField>
            <FormField label={t('depositLink.admin.form.guests')} htmlFor={`${formId}-guests`} required>
              <Input
                type="number"
                min={1}
                value={guests}
                onChange={(event) => setGuests(event.target.value)}
                data-testid="deposit-link-guests"
              />
            </FormField>
          </div>

          <FormField label={t('depositLink.admin.form.roomType')} htmlFor={`${formId}-room-type`} required>
            <Select
              value={roomTypeId}
              onChange={(event) => setRoomTypeId(event.target.value)}
              data-testid="deposit-link-room-type"
            >
              <option value="">{t('depositLink.admin.form.selectRoomType')}</option>
              {roomTypes.map((roomType) => (
                <option key={roomType.id} value={roomType.id}>
                  {roomType.name}
                </option>
              ))}
            </Select>
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('depositLink.admin.form.totalPrice')} htmlFor={`${formId}-total`} required>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={totalPrice}
                onChange={(event) => setTotalPrice(event.target.value)}
                data-testid="deposit-link-total"
              />
            </FormField>
            <FormField
              label={t('depositLink.admin.form.amountDueNow')}
              htmlFor={`${formId}-deposit`}
              hint={t('depositLink.admin.form.amountDueNowHint')}
              required
            >
              <Input
                type="number"
                min={1}
                step="0.01"
                value={amountDueNow}
                onChange={(event) => {
                  setDepositTouched(true);
                  setAmountDueNow(event.target.value);
                }}
                data-testid="deposit-link-amount"
              />
            </FormField>
          </div>

          <FormField label={t('depositLink.admin.form.expiresIn')} htmlFor={`${formId}-expiry`}>
            <Select
              value={String(expiresInHours)}
              onChange={(event) => setExpiresInHours(Number(event.target.value))}
              data-testid="deposit-link-expiry"
            >
              {EXPIRY_CHOICES.map((hours) => (
                <option key={hours} value={hours}>
                  {t('depositLink.admin.form.hours', { count: hours })}
                </option>
              ))}
            </Select>
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('depositLink.admin.form.pmsRef')} htmlFor={`${formId}-pms-ref`}>
              <Input value={pmsRef} onChange={(event) => setPmsRef(event.target.value)} />
            </FormField>
            <FormField label={t('depositLink.admin.form.note')} htmlFor={`${formId}-note`}>
              <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
            </FormField>
          </div>

          {error && (
            <p role="alert" className="text-caption text-error-600" data-testid="deposit-link-error">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={handleClose}>
              {t('depositLink.admin.form.cancel')}
            </Button>
            <Button
              type="submit"
              loading={createMutation.isPending}
              disabled={createMutation.isPending}
              data-testid="deposit-link-submit"
            >
              {t('depositLink.admin.form.submit')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
