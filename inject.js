#!/usr/bin/env node
/**
 * CYBER Pipeline — Script d'injection v5
 * 
 * 1. Crée un repo GitHub client depuis le template CYBER
 * 2. Lit le contenu depuis Supabase (site_content)
 * 3. Injecte dans les fichiers HTML + remplace la couleur primaire CSS
 * 4. Push → Vercel déploie automatiquement
 * 
 * v5: gestion brand-color (variable CSS --_colors---primary)
 */

const { createClient } = require('@supabase/supabase-js');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://odtvadaznmdowtaoknid.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const ORG = 'Veltech-Sas';
const VERCEL_SCOPE = 'veltech-sas-projects';
const TEMPLATE_DIR = path.resolve(__dirname);
const WORK_DIR = path.join(os.homedir(), 'cyber-clients');

const HTML_FILES = [
  'index.html', 'demarrer.html', 'merci.html', 'search.html',
  '401.html', '404.html', 'legal/mentions-legales.html', 'legal/confidentialite.html'
];

const CSS_FILE = 'css/cyber-ia-v2.css';

const IMAGE_SLOT_TYPES = ['image'];
const LINK_SLOT_TYPES = ['link'];

// ─── Supabase ─────────────────────────────────────────────────────────────────

async function fetchSiteContent(supabase, id) {
  const { data, error } = await supabase
    .from('site_content').select('*, clients(slug, name)').eq('id', id).single();
  if (error) throw new Error(`Erreur Supabase: ${error.message}`);
  return data;
}

async function fetchSlotTypes(supabase) {
  const { data, error } = await supabase
    .from('template_slots').select('slot_name, slot_type');
  if (error) throw new Error(`Erreur template_slots: ${error.message}`);
  const map = {};
  for (const row of data) map[row.slot_name] = row.slot_type;
  return map;
}

// ─── GitHub ───────────────────────────────────────────────────────────────────

function createClientRepo(slug) {
  const repoName = `client-${slug}`;
  const fullRepo = `${ORG}/${repoName}`;
  const clientDir = path.join(WORK_DIR, repoName);

  console.log(`📁 Repo client: ${fullRepo}`);
  if (!fs.existsSync(WORK_DIR)) fs.mkdirSync(WORK_DIR, { recursive: true });

  let repoExists = false;
  try { execSync(`gh repo view ${fullRepo} --json name`, { stdio: 'pipe' }); repoExists = true; } catch { }

  if (repoExists) {
    console.log('   ✓ Repo existe déjà');
    if (fs.existsSync(clientDir)) {
      execSync('git pull origin main', { cwd: clientDir, stdio: 'pipe' });
    } else {
      execSync(`gh repo clone ${fullRepo} ${clientDir}`, { stdio: 'pipe' });
    }
    // Recopier les fichiers template pour intégrer les mises à jour (scripts, CSS, etc.)
    copyTemplate(TEMPLATE_DIR, clientDir);
    console.log('   ✓ Template synchronisé');
  } else {
    console.log('   ✦ Création du nouveau repo...');
    if (fs.existsSync(clientDir)) fs.rmSync(clientDir, { recursive: true });
    fs.mkdirSync(clientDir, { recursive: true });
    copyTemplate(TEMPLATE_DIR, clientDir);
    execSync('git init', { cwd: clientDir, stdio: 'pipe' });
    execSync('git add -A', { cwd: clientDir, stdio: 'pipe' });
    execSync('git commit -m "[CYBER] Init depuis template"', { cwd: clientDir, stdio: 'pipe' });
    execSync('git branch -M main', { cwd: clientDir, stdio: 'pipe' });
    execSync(`gh repo create ${fullRepo} --private --source=${clientDir} --push`, { stdio: 'pipe' });
    console.log('   ✓ Repo créé et pushé');
  }
  return clientDir;
}

function copyTemplate(src, dest) {
  const exclude = ['.git', '.vercel', 'node_modules', 'inject.js', 'package.json', 'package-lock.json'];
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (exclude.includes(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyTemplate(s, d); }
    else fs.copyFileSync(s, d);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function replaceSrc(tag, url) {
  if (tag.includes('src="')) tag = tag.replace(/src="[^"]*"/, `src="${url}"`);
  else if (tag.includes("src='")) tag = tag.replace(/src='[^']*'/, `src="${url}"`);
  else tag = tag.replace(/>$/, ` src="${url}">`);
  // Supprimer srcset et sizes
  tag = tag.replace(/\s*srcset="[^"]*"/g, '');
  tag = tag.replace(/\s*sizes="[^"]*"/g, '');
  return tag;
}

function replaceHref(tag, url) {
  if (tag.includes('href="')) return tag.replace(/href="[^"]*"/, `href="${url}"`);
  if (tag.includes("href='")) return tag.replace(/href='[^']*'/, `href="${url}"`);
  return tag.replace(/>$/, ` href="${url}">`);
}

// ─── Couleur primaire ─────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function injectBrandColor(workDir, color) {
  // CSS : remplacer la variable --_colors---primary
  const cssPath = path.join(workDir, CSS_FILE);
  if (!fs.existsSync(cssPath)) {
    console.warn(`⚠️  CSS manquant: ${CSS_FILE}`);
    return;
  }
  let css = fs.readFileSync(cssPath, 'utf-8');
  const before = css;
  css = css.replace(/(--_colors---primary:\s*)#[0-9a-fA-F]{3,8}/, `$1${color}`);
  if (css !== before) {
    fs.writeFileSync(cssPath, css, 'utf-8');
    console.log(`🎨 Couleur primaire: ${color}`);
  } else {
    console.warn('⚠️  Variable --_colors---primary non trouvée dans le CSS');
  }

  // JS : remplacer les placeholders RGB dans les animations Webflow
  const jsPath = path.join(workDir, 'js/cyber-ia-v2.js');
  if (fs.existsSync(jsPath)) {
    let js = fs.readFileSync(jsPath, 'utf-8');
    const { r, g, b } = hexToRgb(color);
    const beforeJs = js;
    js = js.replace(/rValue:BRAND_R,bValue:BRAND_B,gValue:BRAND_G/, `rValue:${r},bValue:${b},gValue:${g}`);
    if (js !== beforeJs) {
      fs.writeFileSync(jsPath, js, 'utf-8');
      console.log(`🎨 RGB animations: rgb(${r},${g},${b})`);
    }
  }
}

// ─── Logo par défaut ─────────────────────────────────────────────────────────

const LOGO_SLOTS = ['nav-logo', 'footer-logo', 'cta-logo', 'service-1-logo', 'service-2-logo', 'service-3-logo'];
const LOGO_DEFAULT_PATH = path.join(__dirname, 'images', 'logo-default.svg');

function generateDefaultLogo(workDir, content) {
  const logoPath = 'images/logo-client.svg';
  const destPath = path.join(workDir, logoPath);
  const clientLogoInTemplate = path.join(__dirname, 'images', 'logo-client.svg');

  if (fs.existsSync(clientLogoInTemplate)) {
    // Logo client custom présent dans le template — déjà copié par copyTemplate
    console.log(`🖼️  Logo client: ${logoPath} (custom)`);
  } else {
    // Pas de logo client — générer depuis logo-default + brand-color
    const brandColor = content['brand-color'];
    if (!brandColor) return;
    if (!fs.existsSync(LOGO_DEFAULT_PATH)) {
      console.warn('⚠️  images/logo-default.svg manquant');
      return;
    }
    const svg = fs.readFileSync(LOGO_DEFAULT_PATH, 'utf-8').replaceAll('#181818', brandColor);
    fs.writeFileSync(destPath, svg, 'utf-8');
    console.log(`🖼️  Logo par défaut: ${logoPath} (${brandColor})`);
  }

  // Injecter le chemin dans les slots logo non renseignés
  for (const slot of LOGO_SLOTS) {
    if (!content[slot]) {
      content[slot] = logoPath;
    }
  }
}

// ─── OG Image ────────────────────────────────────────────────────────────────

const OG_TEMPLATE_PATH = path.join(__dirname, 'images', 'og-template.svg');
const HERO_DEFAULT = 'images/Model-Hero-Image-p-1080.jpg';

function stripHtmlTags(str) {
  return str.replace(/<[^>]*>/g, '').trim();
}

function resolveHeroImage(workDir, content) {
  // Si le client a une hero-image injectée, l'utiliser
  if (content['hero-image'] && fs.existsSync(path.join(workDir, content['hero-image']))) {
    return path.join(workDir, content['hero-image']);
  }
  // Sinon, image hero par défaut du template
  const defaultPath = path.join(workDir, HERO_DEFAULT);
  if (fs.existsSync(defaultPath)) return defaultPath;
  return null;
}

async function generateOgImage(content, workDir) {
  if (!fs.existsSync(OG_TEMPLATE_PATH)) {
    console.warn('⚠️  images/og-template.svg manquant');
    return;
  }

  const heroPath = resolveHeroImage(workDir, content);
  if (!heroPath) {
    console.warn('⚠️  Aucune hero image trouvée, OG image ignorée');
    return;
  }

  // Lire le hero et convertir en base64 data URI
  const heroBuffer = fs.readFileSync(heroPath);
  const ext = path.extname(heroPath).slice(1).replace('jpg', 'jpeg');
  const heroDataUri = `data:image/${ext};base64,${heroBuffer.toString('base64')}`;

  const brandColor = content['brand-color'] || '#181818';
  const logo = content['footer-copyright-name'] || '';
  const title = stripHtmlTags(content['hero-title'] || '');

  let svg = fs.readFileSync(OG_TEMPLATE_PATH, 'utf-8');
  svg = svg.replace('HERO_DATA_URI', heroDataUri);
  svg = svg.replaceAll('BRAND_COLOR', brandColor);
  svg = svg.replace('>LOGO<', `>${logo}<`);
  svg = svg.replace('>TITLE<', `>${title}<`);

  const outPath = path.join(workDir, 'images', 'og-image.png');
  await sharp(Buffer.from(svg)).png().toFile(outPath);
  console.log(`🖼️  OG image: images/og-image.png`);

  if (!content['og-image']) {
    content['og-image'] = 'images/og-image.png';
  }
}

// ─── Injection HTML ───────────────────────────────────────────────────────────

function injectAllSlots(html, content, slotTypes) {
  let injectedCount = 0;
  let skippedCount = 0;

  // Meta : <title data-slot>
  html = html.replace(/<title\s+data-slot="([^"]*)">[^<]*(?:<[^/][^<]*)*<\/title>/g, (match, slot) => {
    const v = content[slot];
    if (v === undefined) { skippedCount++; return match; }
    injectedCount++;
    return `<title data-slot="${slot}">${escapeHtml(v)}</title>`;
  });

  // Meta : <meta data-slot content>
  html = html.replace(/(<meta\s[^>]*data-slot="([^"]*)"[^>]*content=")([^"]*)("[^>]*>)/g, (m, before, slot, old, after) => {
    const v = content[slot]; if (v === undefined) { skippedCount++; return m; }
    injectedCount++; return `${before}${escapeHtml(v)}${after}`;
  });
  html = html.replace(/(<meta\s[^>]*content=")([^"]*)("[^>]*data-slot="([^"]*)"[^>]*>)/g, (m, before, old, after, slot) => {
    const v = content[slot]; if (v === undefined) { skippedCount++; return m; }
    injectedCount++; return `${before}${escapeHtml(v)}${after}`;
  });

  // Link : <link data-slot href>
  html = html.replace(/(<link\s[^>]*data-slot="([^"]*)"[^>]*href=")([^"]*)("[^>]*>)/g, (m, before, slot, old, after) => {
    const v = content[slot]; if (v === undefined) { skippedCount++; return m; }
    injectedCount++; return `${before}${v}${after}`;
  });
  html = html.replace(/(<link\s[^>]*href=")([^"]*)("[^>]*data-slot="([^"]*)"[^>]*>)/g, (m, before, old, after, slot) => {
    const v = content[slot]; if (v === undefined) { skippedCount++; return m; }
    injectedCount++; return `${before}${v}${after}`;
  });

  // Img : <img data-slot>
  html = html.replace(/<img\s[^>]*data-slot="([^"]*)"[^>]*\/?>/g, (match, slot) => {
    const v = content[slot]; if (v === undefined) { skippedCount++; return match; }
    injectedCount++; return replaceSrc(match, v);
  });

  // Tous les autres éléments
  html = html.replace(/<([a-z][a-z0-9]*)\s([^>]*data-slot="([^"]*)"[^>]*)>([\s\S]*?)<\/\1>/gi, (match, tag, attrs, slot, inner) => {
    const v = content[slot]; if (v === undefined) { skippedCount++; return match; }
    const type = slotTypes[slot] || 'text';
    injectedCount++;

    if (IMAGE_SLOT_TYPES.includes(type)) {
      return `<${tag} ${replaceSrc(attrs + '>', v).slice(0, -1)}>${inner}</${tag}>`;
    }
    if (LINK_SLOT_TYPES.includes(type)) {
      return `${replaceHref(`<${tag} ${attrs}>`, v)}${inner}</${tag}>`;
    }
    if (type === 'phone' && tag.toLowerCase() === 'a') {
      return `${replaceHref(`<${tag} ${attrs}>`, `tel:${v.replace(/\s/g, '')}`)}${v}</${tag}>`;
    }
    // Slots compteur : clé contenant "-number" → data-target + textContent "0"
    if (slot.includes('-number')) {
      const num = parseInt(v.replace(/\s/g, ''), 10) || 0;
      let newAttrs = attrs.replace(/data-target="[^"]*"/, `data-target="${num}"`);
      if (!newAttrs.includes('data-target=')) newAttrs += ` data-target="${num}"`;
      return `<${tag} ${newAttrs}>0</${tag}>`;
    }
    return `<${tag} ${attrs}>${v}</${tag}>`;
  });

  return { html, injectedCount, skippedCount };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const identifier = args.find(a => !a.startsWith('--'));

  if (!identifier) { console.error('Usage: node inject.js [--dry-run] <site_content_id>'); process.exit(1); }
  if (!SUPABASE_KEY) { console.error('❌ SUPABASE_SERVICE_KEY manquante'); process.exit(1); }

  console.log('\n🚀 CYBER Pipeline — Injection v5');
  console.log(`   Mode: ${dryRun ? 'DRY RUN' : 'PRODUCTION'}\n`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // 1. Contenu
  console.log('📦 Chargement contenu...');
  const sc = await fetchSiteContent(supabase, identifier);
  const content = sc.content;
  const slug = sc.clients?.slug;
  const name = sc.clients?.name;
  if (!content || !Object.keys(content).length) { console.error('❌ Contenu vide'); process.exit(1); }
  if (!slug) { console.error('❌ Slug introuvable'); process.exit(1); }
  console.log(`   ✓ ${name} (${slug}) — ${Object.keys(content).length} slots, v${sc.version}\n`);

  // 2. Repo
  let workDir;
  if (dryRun) { workDir = TEMPLATE_DIR; console.log('📁 Dry-run: template local'); }
  else workDir = createClientRepo(slug);
  console.log('');

  // 3. Couleur primaire
  if (content['brand-color'] && !dryRun) {
    injectBrandColor(workDir, content['brand-color']);
  } else if (content['brand-color'] && dryRun) {
    console.log(`🎨 Couleur primaire (dry-run): ${content['brand-color']}`);
  }

  // 4. Logo par défaut (recolorisé)
  if (!dryRun) {
    generateDefaultLogo(workDir, content);
  }

  // 5. OG image
  if (!dryRun) {
    await generateOgImage(content, workDir);
  }

  // 6. Types de slots
  const slotTypes = await fetchSlotTypes(supabase);

  // 6. Injection HTML
  let totalI = 0, totalS = 0;
  for (const file of HTML_FILES) {
    const fp = path.join(workDir, file);
    if (!fs.existsSync(fp)) { console.warn(`⚠️  Manquant: ${file}`); continue; }
    const result = injectAllSlots(fs.readFileSync(fp, 'utf-8'), content, slotTypes);
    console.log(`📄 ${file.padEnd(35)} ${result.injectedCount} injectés, ${result.skippedCount} vides`);
    totalI += result.injectedCount; totalS += result.skippedCount;
    if (!dryRun) fs.writeFileSync(fp, result.html, 'utf-8');
  }
  console.log(`\n✅ ${totalI} injectés, ${totalS} vides`);

  if (dryRun) { console.log('\n🔍 Dry-run terminé.\n'); return; }

  // 7. Push
  console.log('\n📤 Commit et push...');
  try {
    const msg = `[CYBER] Injection — ${slug} v${sc.version}`;
    execSync('git add -A', { cwd: workDir, stdio: 'pipe' });
    execSync(`git commit -m "${msg}"`, { cwd: workDir, stdio: 'pipe' });
    execSync('git push origin main', { cwd: workDir, stdio: 'pipe' });
    console.log(`   ✓ Pushé: "${msg}"`);
  } catch (err) {
    if (err.stderr?.toString().includes('nothing to commit')) console.log('   ℹ️  Rien à committer');
    else { console.error(`   ❌ Git: ${err.message}`); process.exit(1); }
  }

  // 8. Vercel deploy
  console.log('\n🚀 Déploiement Vercel...');
  const repoName = `client-${slug}`;
  let vercelUrl = `https://${repoName}.vercel.app`;
  try {
    const out = execSync(
      `npx vercel --yes --scope ${VERCEL_SCOPE} --prod 2>&1`,
      { cwd: workDir, stdio: 'pipe', timeout: 120000 }
    ).toString();
    const aliasMatch = out.match(/Aliased:\s+(https:\/\/[^\s]+)/);
    if (aliasMatch) vercelUrl = aliasMatch[1];
    console.log(`   ✓ Vercel: ${vercelUrl}`);
  } catch (err) {
    console.warn(`   ⚠️  Vercel: ${err.message.split('\n')[0]}`);
  }

  // 9. Supabase
  const repoUrl = `https://github.com/${ORG}/${repoName}`;
  const { error } = await supabase.from('site_content')
    .update({ status: 'deployed', deployed_url: vercelUrl, github_repo: repoUrl, last_deployed_at: new Date().toISOString() })
    .eq('id', sc.id);
  if (error) console.warn(`⚠️  Supabase: ${error.message}`);
  else console.log('   ✓ Supabase: deployed');

  console.log(`\n🎉 Terminé !\n   Repo: ${repoUrl}\n   Live: ${vercelUrl}\n`);
}

main().catch(err => { console.error(`❌ ${err.message}`); process.exit(1); });
