import {useApp} from '../context/AppContext';
import {Modal} from './UI';

export function CartReplacementDialog({onCancel, onConfirm}: {onCancel: () => void; onConfirm: () => void}) {
  const {t} = useApp();
  return <Modal title={t('replaceTitle')} onClose={onCancel}>
    <div className="p-6">
      <p className="text-sm leading-relaxed text-[var(--muted)]">{t('replaceText')}</p>
      <div className="mt-6 flex gap-3">
        <button className="button-secondary flex-1" onClick={onCancel}>{t('cancel')}</button>
        <button className="button-primary flex-1" onClick={onConfirm}>{t('replace')}</button>
      </div>
    </div>
  </Modal>;
}
