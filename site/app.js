const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

const headerState = () => document.body.classList.toggle('is-scrolled', scrollY > 130);
addEventListener('scroll', headerState, { passive: true });
headerState();

$('[data-year]').textContent = new Date().getFullYear();

// Keep previously shared section links useful after merging the records.
function redirectLegacySection() {
  if (!['#current', '#work'].includes(location.hash)) return;
  history.replaceState(null, '', '#notes');
  $('#notes').scrollIntoView({ behavior: 'instant' });
}
addEventListener('hashchange', redirectLegacySection);
redirectLegacySection();

const menu = $('#navigation');
const menuToggle = $('.menu-toggle');
const projectDialog = $('#project-dialog');
let dialogTrigger = null;
function openDialog(dialog, trigger) {
  dialogTrigger = trigger;
  dialog.showModal();
  document.body.classList.add('dialog-open');
  if (dialog === menu) menuToggle.setAttribute('aria-expanded', 'true');
  $('[data-close]', dialog).focus();
}
function closeDialog(dialog) { dialog.close(); }
for (const dialog of [menu, projectDialog]) {
  $('[data-close]', dialog).addEventListener('click', () => closeDialog(dialog));
  dialog.addEventListener('close', () => {
    document.body.classList.remove('dialog-open');
    menuToggle.setAttribute('aria-expanded', 'false');
    dialogTrigger?.focus({ preventScroll: true });
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(dialog);
  });
}
menuToggle.addEventListener('click', () => openDialog(menu, menuToggle));
$$('a', menu).forEach(link => link.addEventListener('click', event => {
  const target = $(link.getAttribute('href'));
  if (!target) return;
  event.preventDefault(); dialogTrigger = target; closeDialog(menu);
  history.pushState(null, '', link.getAttribute('href'));
  target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
  target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}));

let projectsPromise;
async function getProjects() {
  if (!projectsPromise) projectsPromise = fetch('./projects.json').then(response => {
    if (!response.ok) throw new Error('Projects unavailable');
    return response.json();
  }).then(data => data.projects).catch(error => { projectsPromise = null; throw error; });
  return projectsPromise;
}
function fillProject(project) {
  $('#project-dialog-category').textContent = project.category + ' / ' + project.statusLabel;
  $('#project-dialog-title').textContent = project.title;
  $('.project-dialog-headline').textContent = project.headline;
  $('.project-dialog-summary').textContent = project.summary;
  const picture = $('.project-dialog-image');
  picture.hidden = !project.image;
  if (project.image) { picture.src = project.image.src; picture.alt = project.image.alt; }
  else { picture.removeAttribute('src'); picture.alt = ''; }
  $('.project-dialog-highlights').replaceChildren(...project.highlights.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
  $('.project-dialog-tags').replaceChildren(...project.tags.map(text => { const tag = document.createElement('span'); tag.textContent = text; return tag; }));
  const links = $('.project-dialog-links');
  links.replaceChildren(...project.links.map(item => {
    const link = document.createElement('a');
    link.textContent = item.label + ' ↗'; link.href = item.url; link.target = '_blank'; link.rel = 'noreferrer'; return link;
  }));
  if (!project.links.length) {
    const link = document.createElement('a');
    link.href = 'mailto:my18874068595@gmail.com?subject=' + encodeURIComponent('想了解' + project.title);
    link.textContent = '联系我，了解这个项目 ↗'; links.append(link);
  }
}
$$('[data-project]').forEach(button => button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    const projects = await getProjects();
    const project = projects.find(item => item.id === button.dataset.project);
    if (!project) throw new Error('Project not found');
    fillProject(project);
    openDialog(projectDialog, button);
    projectDialog.scrollTop = 0;
  } catch { toast('项目暂时未加载成功，请再点一次。'); }
  finally { button.disabled = false; }
}));

let toastTimer;
function toast(message) {
  const element = $('#toast'); element.textContent = message;
  element.classList.add('is-visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove('is-visible'), 3500);
}
$('#copy-email').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText('my18874068595@gmail.com'); toast('邮箱已复制'); }
  catch { toast('复制未成功，可长按或选中邮箱地址复制。'); }
});

if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
  }), { threshold: 0.08 });
  $$('.section-heading, .record-entry, .about-layout').forEach(element => {
    element.classList.add('will-reveal'); observer.observe(element);
  });
}
