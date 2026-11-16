// صفحه‌ی اصلی: خوشامد، اطلاعات شرکت و کارت‌های دسترسی سریع به ماژول‌ها
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { registerModule, homeCards, getExtensions } from '../../core/registry.js';
import { session } from '../../core/session.js';
import { formatJalali, todayIso, weekdayName } from '../../core/jalali.js';
import { getCompany } from '../settings/index.js';

async function homePage(ctx) {
  ctx.setTitle('حسابداری');
  ctx.setBack(null);
  const company = await getCompany(ctx.db);
  const today = todayIso();
  ctx.el.append(
    h(
      'div',
      { class: 'hero' },
      company.logo ? h('img', { src: company.logo, alt: '' }) : icon('building', 40),
      h(
        'div',
        null,
        h('h2', null, company.name || 'شرکت شما'),
        h('p', null, `${session.userName ? session.userName + ' · ' : ''}${weekdayName(today)} ${formatJalali(today, { long: true })}`)
      )
    )
  );
  const tiles = h('div', { class: 'tiles' });
  for (const m of homeCards()) {
    const sub = h('small', null, '');
    if (m.home.count) m.home.count(ctx.db).then((t) => (sub.textContent = t));
    tiles.append(h('button', { class: 'tile', onclick: () => ctx.go(m.home.path) }, icon(m.home.icon, 26), h('b', null, m.home.label), sub));
  }
  ctx.el.append(tiles);
  for (const ext of getExtensions('home.widget')) {
    try {
      const node = await ext(ctx);
      if (node) ctx.el.append(node);
    } catch (e) {
      console.error('home widget', e);
    }
  }
}

export function registerHome() {
  registerModule({
    id: 'home',
    title: 'خانه',
    nav: { order: 10, label: 'خانه', icon: 'home', path: '/' },
    routes: [{ path: '/', render: homePage }],
  });
}
