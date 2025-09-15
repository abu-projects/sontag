const fs = require('fs');
const path = require('path');

function readFileSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function slugify(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    .replace(/-+/g, '-');
}

function parseFrontMatter(md) {
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fmMatch) return { data: {}, content: md };
  const body = md.slice(fmMatch[0].length);
  const data = {};
  fmMatch[1].split(/\r?\n/).forEach(line => {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*"?([\s\S]*?)"?$/);
    if (m) data[m[1].trim()] = m[2].trim();
  });
  return { data, content: body };
}

function mdInline(text) {
  // images ![alt](src)
  let out = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, src) => {
    // rewrite paths from ./brief_insurance_site/ to ./
    src = src.replace(/^\.\/brief_insurance_site\//, './');
    return `<img src="${src}" alt="${alt}">`;
  });
  // links [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // bold **text**
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // italics _text_ or *text*
  out = out.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^_])_([^_]+)_(?!_)/g, '$1<em>$2</em>');
  return out;
}

function mdBlock(md) {
  const lines = md.split(/\r?\n/);
  const html = [];
  let inList = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { // blank
      if (inList) { html.push('</ul>'); inList = false; }
      continue;
    }
    if (/^###\s+/.test(line)) {
      if (inList) { html.push('</ul>'); inList = false; }
      html.push(`<h3>${mdInline(line.replace(/^###\s+/, ''))}</h3>`);
      continue;
    }
    if (/^##\s+/.test(line)) {
      if (inList) { html.push('</ul>'); inList = false; }
      html.push(`<h2>${mdInline(line.replace(/^##\s+/, ''))}</h2>`);
      continue;
    }
    if (/^#\s+/.test(line)) {
      if (inList) { html.push('</ul>'); inList = false; }
      html.push(`<h1>${mdInline(line.replace(/^#\s+/, ''))}</h1>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      if (inList) { html.push('</ul>'); inList = false; }
      html.push(`<blockquote><p>${mdInline(line.replace(/^>\s?/, ''))}</p></blockquote>`);
      continue;
    }
    if (/^-\s+/.test(line)) {
      if (!inList) { html.push('<ul>'); inList = true; }
      html.push(`<li>${mdInline(line.replace(/^-\s+/, ''))}</li>`);
      continue;
    }
    // paragraph
    if (inList) { html.push('</ul>'); inList = false; }
    html.push(`<p>${mdInline(line)}</p>`);
  }
  if (inList) html.push('</ul>');
  return html.join('\n');
}

function loadTheme2Vars(theme2) {
  const palette = {};
  const pal = theme2?.settings?.color?.palette || [];
  pal.forEach(p => { palette[p.slug] = p.color; });
  const fonts = (theme2?.settings?.typography?.fontFamilies || []).reduce((acc, f) => {
    acc[f.slug] = f.fontFamily; return acc;
  }, {});
  return {
    '--color-primary': palette['primary'] || '#3c5644',
    '--color-secondary': palette['sand'] || '#d5cabf',
    '--color-accent': palette['accent'] || '#2a3d31',
    '--color-background': palette['background'] || '#ffffff',
    '--color-surface': '#ffffff',
    '--color-text-primary': palette['text'] || '#2c2c2c',
    '--color-text-secondary': palette['muted'] || '#666666',
    '--color-text-light': palette['muted'] || '#999999',
    '--color-text-inverse': '#ffffff',
    '--font-primary': fonts['brand-sans'] || "Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    '--font-secondary': "Georgia, 'Times New Roman', serif"
  };
}

function renderTheme2CSS(vars) {
  const lines = Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`);
  return `:root {\n${lines.join('\n')}\n}`;
}

function build() {
  const cwd = process.cwd();
  const contentPath = path.join(cwd, 'content.md');
  const theme3Path = path.join(cwd, 'theme3.json');
  const theme2Path = path.join(cwd, 'theme2.json');
  const stylesPath = path.join(cwd, 'styles.css');
  const scriptPath = path.join(cwd, 'script.js');

  const mdRaw = readFileSafe(contentPath);
  if (!mdRaw) throw new Error('content.md not found');
  const { data: fm, content } = parseFrontMatter(mdRaw);

  const themeRaw = readFileSafe(theme3Path) || readFileSafe(theme2Path);
  const themeObj = themeRaw ? JSON.parse(themeRaw) : {};
  const cssVars = loadTheme2Vars(themeObj);
  // theme3 fonts mapping if available
  const tFonts = (themeObj?.settings?.typography?.fontFamilies || []).reduce((acc, f) => {
    acc[f.slug] = f.fontFamily; return acc;
  }, {});
  if (tFonts['body-sans']) cssVars['--font-primary'] = tFonts['body-sans'];
  if (tFonts['display-serif']) cssVars['--font-heading'] = tFonts['display-serif'];

  const sectionsRaw = content.split(/\n---\n/g).map(s => s.trim()).filter(Boolean);
  const sections = sectionsRaw.map(sec => {
    // heading is the first markdown heading line
    const match = sec.match(/^(#{1,6})\s+(.+)$/m);
    const title = match ? match[2].trim() : 'Abschnitt';
    const id = slugify(title);
    const html = mdBlock(sec);
    return { id, title, html };
  });

  // Build navigation from sections
  const navLinks = sections.map((s, i) => `<li><a href="#${s.id}" class="nav-link">${s.title}</a></li>`).join('\n                ');

  // Hero is first section if template is onepage
  const isOnepage = (fm.template || '').toLowerCase() === 'onepage';

  const headTitle = fm.title || 'Website';

  const logoPath = 'sonntag_logo.svg';

  const htmlParts = [];
  htmlParts.push(`<!DOCTYPE html>`);
  htmlParts.push(`<html lang="de">`);
  htmlParts.push(`<head>`);
  htmlParts.push(`  <meta charset="UTF-8">`);
  htmlParts.push(`  <meta name="viewport" content="width=device-width, initial-scale=1.0">`);
  htmlParts.push(`  <title>${headTitle}</title>`);
  htmlParts.push(`  <link rel="preconnect" href="https://fonts.googleapis.com">`);
  htmlParts.push(`  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`);
  htmlParts.push(`  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&display=swap" rel="stylesheet">`);
  htmlParts.push(`  <link rel="stylesheet" href="theme3.css">`);
  htmlParts.push(`  <link rel="stylesheet" href="styles.css">`);
  htmlParts.push(`</head>`);
  htmlParts.push(`<body>`);
  htmlParts.push(`  <nav class="navbar">`);
  htmlParts.push(`    <div class="container">`);
  htmlParts.push(`      <div class="nav-brand">`);
  htmlParts.push(`        <img src="${logoPath}" alt="Logo" class="logo">`);
  htmlParts.push(`      </div>`);
  htmlParts.push(`      <ul class="nav-menu">`);
  htmlParts.push(`        ${navLinks}`);
  htmlParts.push(`      </ul>`);
  htmlParts.push(`      <div class="hamburger"><span></span><span></span><span></span></div>`);
  htmlParts.push(`    </div>`);
  htmlParts.push(`  </nav>`);

  if (isOnepage && sections.length > 0) {
    const first = sections[0];
    const heroImage = themeObj?.settings?.custom?.heroImage || 'a.jpg';
    const heroImageBase = path.basename(heroImage);
    htmlParts.push(`  <section id="${first.id}" class="hero hero--image" style="background-image:url('${heroImageBase}')">`);
    htmlParts.push(`    <div class="container">`);
    htmlParts.push(`      <div class="hero-content">`);
    // Render first section content inside hero
    htmlParts.push(first.html);
    htmlParts.push(`      </div>`);
    htmlParts.push(`    </div>`);
    htmlParts.push(`  </section>`);
  }

  const startIdx = isOnepage ? 1 : 0;
  for (let i = startIdx; i < sections.length; i++) {
    const s = sections[i];
    const extraClass = s.id === 'kontakt' ? ' contact' : (s.id === 'team' ? ' team' : (s.id === 'leistungen' ? ' services' : ''));
    htmlParts.push(`  <section id="${s.id}" class="${extraClass.trim()}">`);
    htmlParts.push(`    <div class="container">`);
    htmlParts.push(`      <div class="section-header">`);
    htmlParts.push(`        <h2 class="section-title">${s.title}</h2>`);
    htmlParts.push(`      </div>`);
    // If Kontakt, also include a basic form to satisfy script.js
    if (s.id === 'kontakt') {
      htmlParts.push(`      <div class="contact-content">`);
      htmlParts.push(`        <div class="contact-info">${s.html}</div>`);
      htmlParts.push(`        <div class="contact-form">`);
      htmlParts.push(`          <form>`);
      htmlParts.push(`            <div class="form-group"><label for="name">Name *</label><input id="name" name="name" required></div>`);
      htmlParts.push(`            <div class="form-group"><label for="email">E‑Mail *</label><input type="email" id="email" name="email" required></div>`);
      htmlParts.push(`            <div class="form-group"><label for="message">Nachricht *</label><textarea id="message" name="message" rows="5" required></textarea></div>`);
      htmlParts.push(`            <button type="submit" class="btn btn-primary">Nachricht senden</button>`);
      htmlParts.push(`          </form>`);
      htmlParts.push(`        </div>`);
      htmlParts.push(`      </div>`);
    } else {
      htmlParts.push(s.html);
    }
    htmlParts.push(`    </div>`);
    htmlParts.push(`  </section>`);
  }

  htmlParts.push(`  <footer class="footer">`);
  htmlParts.push(`    <div class="container">`);
  htmlParts.push(`      <div class="footer-content">`);
  htmlParts.push(`        <div class="footer-brand">`);
  htmlParts.push(`          <img src="${logoPath}" alt="Logo" class="footer-logo">`);
  htmlParts.push(`          <p>${headTitle}</p>`);
  htmlParts.push(`        </div>`);
  htmlParts.push(`      </div>`);
  htmlParts.push(`      <div class="footer-bottom">`);
  htmlParts.push(`        <p>&copy; ${(new Date()).getFullYear()} Sonntag GmbH</p>`);
  htmlParts.push(`      </div>`);
  htmlParts.push(`    </div>`);
  htmlParts.push(`  </footer>`);

  htmlParts.push(`  <script src="script.js"></script>`);
  htmlParts.push(`</body>`);
  htmlParts.push(`</html>`);

  // Write outputs
  const dist = path.join(cwd, 'dist');
  ensureDir(dist);

  let themeCSS = renderTheme2CSS(cssVars);
  themeCSS += `\n/* Theme3 small overrides */\n`;
  themeCSS += `h1,h2,h3,h4,h5,h6{font-family: var(--font-heading, var(--font-primary));}`;
  themeCSS += `\n.hero{background-size:cover;background-position:center;background-repeat:no-repeat;position:relative;}\n`;
  themeCSS += `.hero.hero--image::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg, rgba(237,234,229,0.25) 0%, rgba(237,234,229,0.75) 100%);}\n`;
  themeCSS += `.hero .hero-content{position:relative;}`;
  fs.writeFileSync(path.join(dist, 'theme3.css'), themeCSS, 'utf8');

  const htmlOut = htmlParts.join('\n');
  fs.writeFileSync(path.join(dist, 'index.html'), htmlOut, 'utf8');

  // copy assets
  const toCopy = [stylesPath, scriptPath, path.join(cwd, 'sonntag_logo.svg')];
  toCopy.forEach(src => {
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(dist, path.basename(src)));
    }
  });

  // copy images referenced in content (basic heuristic)
  const imgNames = ['a.jpg','b.jpg','c.jpg','d.jpg'];
  imgNames.forEach(name => {
    const src = path.join(cwd, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dist, name));
  });

  // Copy hero custom image if provided and exists
  const heroCustom = themeObj?.settings?.custom?.heroImage;
  if (heroCustom) {
    const heroSrc = path.join(cwd, heroCustom);
    if (fs.existsSync(heroSrc)) {
      fs.copyFileSync(heroSrc, path.join(dist, path.basename(heroCustom)));
    }
  }

  // Also write a root index.html for convenience
  fs.writeFileSync(path.join(cwd, 'index.html'), htmlOut, 'utf8');

  console.log('Built index.html and dist/index.html using theme3 (fallback to theme2) and content.md');
}

try {
  build();
} catch (e) {
  console.error('Build failed:', e.message);
  process.exit(1);
}
