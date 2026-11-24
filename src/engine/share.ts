// Arabic WhatsApp/share text. No personal signature, phone or originator identity.
import type { Evaluation } from '../state/draft';
import type { Draft } from '../state/draft';
import { formatMoney, formatPercent } from '../lib/num';
import { durationLabel } from '../lib/arabic';

const BODY: Record<Draft['bodyType'], string> = { private: 'ملاكي', pickup: 'ربع نقل', jumbo: 'جامبو' };
const CLIENT: Record<Draft['clientType'], string> = { employee: 'موظف', business: 'صاحب عمل' };

function costLine(label: string, ev: Evaluation['admin'], amount: number | null, status: string): string {
  if (status === 'none') return `• ${label}: لا يوجد`;
  if (status === 'known') return `• ${label}: ${formatMoney(amount ?? 0)}`;
  if (status === 'estimate' && ev.value.mode === 'percent') {
    return `• ${label}: ${formatPercent(ev.value.pct)} (الأساس غير مؤكد، تقديرياً ${formatMoney(amount ?? 0)}، غير محسوبة في الكاش)`;
  }
  return `• ${label}: غير محددة بعد`;
}

export function buildShareText(d: Draft, ev: Evaluation): string {
  const c = ev.calc;
  const lines: string[] = [];
  const name = d.clientName.trim();
  lines.push(name ? `أهلاً ${name}، هذا ملخص عرض تمويل تقديري:` : 'ملخص عرض تمويل تقديري:');
  const prog = ev.programme ? ` · ${ev.programme.nameAr}` : '';
  const ins = ev.programme?.insuranceChoice ? ` · ${d.insurance === 'with' ? 'بتأمين' : 'بدون تأمين'}` : '';
  lines.push(`• الجهة: ${ev.bankName}${prog}${ins}`);
  lines.push(`• السيارة: ${BODY[d.bodyType]} | العميل: ${CLIENT[d.clientType]}`);
  if (!c.ok) {
    lines.push('• البيانات غير مكتملة لحساب العرض.');
    lines.push('');
    lines.push('الأرقام تقديرية وتخضع لتأكيد الجهة الممولة والموافقة النهائية.');
    return lines.join('\n');
  }
  lines.push(`• سعر السيارة: ${formatMoney(c.price!)}`);
  lines.push(`• المقدم (${formatPercent(c.downPct ?? 0)}): ${formatMoney(c.downAmount!)}`);
  if (c.fullCash) {
    lines.push('• سداد نقدي كامل، بدون تمويل أو أقساط.');
  } else {
    lines.push(`• مبلغ التمويل: ${formatMoney(c.loan!)}`);
    lines.push(`• المدة: ${durationLabel(c.months!)}`);
    if (ev.rate !== null) {
      lines.push(`• النسبة: ${formatPercent(ev.rate)} سنوياً ثابتة على أصل مبلغ التمويل`);
      lines.push(`• القسط الشهري: ${formatMoney(c.monthly!)}`);
    } else {
      lines.push('• النسبة: غير محددة بعد، والقسط يُحسب بعد تحديدها');
    }
  }
  lines.push(costLine('المصاريف الإدارية', ev.admin, c.admin.amount, c.admin.status));
  lines.push(costLine('التأمين المطلوب عند الاستلام', ev.insurance, c.insurance.amount, c.insurance.status));
  if (c.extra > 0) lines.push(`• ${ev.extra.label}: ${formatMoney(c.extra)}`);
  if (c.cashbackDeducted > 0) lines.push(`• كاش باك مخصوم عند الاستلام: ${formatMoney(c.cashbackDeducted)}`);
  lines.push(
    c.cashComplete
      ? `• المطلوب كاش عند الاستلام: ${formatMoney(c.cashKnown!)}`
      : `• الكاش المعروف حتى الآن عند الاستلام: ${formatMoney(c.cashKnown!)} (غير شامل البنود غير المحددة)`,
  );
  if (c.cashbackSeparate > 0) lines.push(`• كاش باك ${d.cashbackTiming === 'later' ? 'لاحق' : 'توقيته غير محدد'}: ${formatMoney(c.cashbackSeparate)} (غير مخصوم من الكاش)`);
  const pending = c.missing.filter((m) => !m.startsWith('النسبة'));
  if (pending.length) {
    lines.push('');
    lines.push('بنود لم تتحدد بعد:');
    for (const m of pending) lines.push(`- ${m.split(':')[0]}`);
  }
  if (c.insurance.status === 'known' || c.insurance.status === 'estimate' || c.insurance.status === 'unknown') {
    lines.push('- أي أقساط أو تجديدات تأمين لاحقة غير مشمولة في الأرقام.');
  }
  lines.push('');
  lines.push('الأرقام تقديرية وتخضع لتأكيد الجهة الممولة والموافقة النهائية.');
  return lines.join('\n');
}

export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
