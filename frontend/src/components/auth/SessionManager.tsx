import { useSessionTimeout } from '../../hooks/useSessionTimeout';

export default function SessionManager() {
  useSessionTimeout();
  return null;
}