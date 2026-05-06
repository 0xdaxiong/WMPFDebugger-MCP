'use strict';

const fs = require('fs');
const path = require('path');

const SCAN_EXTENSIONS = new Set([
  '.js', '.json', '.html', '.htm', '.wxml', '.wxss', '.css',
  '.txt', '.xml', '.svg', '.ts', '.jsx', '.tsx', '.md',
  '.yaml', '.yml', '.cfg', '.ini', '.conf', '.env', '.properties',
]);

const CATEGORY_LABELS = {
  cloud_credentials: 'Cloud Credentials',
  api_keys: 'API Keys',
  tokens: 'Tokens',
  auth_headers: 'Auth Headers',
  private_keys: 'Private Keys',
  webhooks: 'Webhooks',
  database: 'Database',
  pii_phone: 'Phone Numbers',
  pii_idcard: 'ID Cards',
  pii_email: 'Email',
  network_ip: 'IP Addresses',
  network_domain: 'Domains',
  network_url: 'URLs',
  jwt: 'JWT Tokens',
  crypto: 'Crypto References',
  custom: 'Custom Rules',
};

class SensitiveScanner {
  constructor(rulesPath = null) {
    this._rulesPath = rulesPath || path.join(__dirname, '..', 'rules', 'secret_rules.json');
    this._rules = [];
    this._customRules = [];
    this._loadRules();
  }

  _loadRules() {
    try {
      if (fs.existsSync(this._rulesPath)) {
        const raw = JSON.parse(fs.readFileSync(this._rulesPath, 'utf8'));
        this._rules = raw.map(r => ({
          ...r,
          _regex: new RegExp(r.pattern, r.flags || 'g'),
        }));
      }
    } catch {}
  }

  addCustomRule(name, pattern, category = 'custom', severity = 'medium') {
    try {
      const regex = new RegExp(pattern, 'g');
      this._customRules.push({ id: `custom_${name}`, name, pattern, category, severity, _regex: regex });
      return true;
    } catch {
      return false;
    }
  }

  removeCustomRule(name) {
    this._customRules = this._customRules.filter(r => r.name !== name);
  }

  getAllRules() {
    return [...this._rules, ...this._customRules];
  }

  async scanDirectory(dirPath, options = {}) {
    const { onProgress = null, maxFileSize = 5 * 1024 * 1024 } = options;
    const files = this._collectFiles(dirPath);
    const totalFiles = files.length;
    const results = new Map();
    let scanned = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (onProgress && i % 20 === 0) {
        onProgress({ scanned: i, total: totalFiles, found: results.size });
      }

      try {
        const stat = fs.statSync(file);
        if (stat.size > maxFileSize) continue;

        const content = fs.readFileSync(file, 'utf8');
        const fileFindings = this._scanContent(content, file, dirPath);

        for (const finding of fileFindings) {
          const key = `${finding.ruleId}:${finding.value}`;
          if (!results.has(key)) {
            results.set(key, finding);
          } else {
            results.get(key).locations.push(...finding.locations);
          }
        }
      } catch {}

      scanned++;
      if (i % 50 === 49) {
        await new Promise(r => setImmediate(r));
      }
    }

    if (onProgress) {
      onProgress({ scanned: totalFiles, total: totalFiles, found: results.size });
    }

    const findings = Array.from(results.values());
    findings.sort((a, b) => {
      const sev = { critical: 0, high: 1, medium: 2, low: 3 };
      return (sev[a.severity] || 3) - (sev[b.severity] || 3);
    });

    return {
      directory: dirPath,
      totalFiles,
      scannedFiles: scanned,
      findings,
      summary: this._buildSummary(findings),
    };
  }

  _scanContent(content, filePath, baseDir) {
    const findings = [];
    const allRules = this.getAllRules();
    const relativePath = path.relative(baseDir, filePath);
    const lines = content.split('\n');

    for (const rule of allRules) {
      rule._regex.lastIndex = 0;
      let match;
      while ((match = rule._regex.exec(content)) !== null) {
        const value = match[0];
        if (value.length < 4 || value.length > 500) continue;

        const lineNum = content.substring(0, match.index).split('\n').length;
        const lineContent = lines[lineNum - 1] || '';

        findings.push({
          ruleId: rule.id,
          ruleName: rule.name,
          category: rule.category,
          severity: rule.severity,
          value: value.length > 100 ? value.substring(0, 100) + '...' : value,
          locations: [{ file: relativePath, line: lineNum, context: lineContent.trim().substring(0, 200) }],
        });

        if (findings.length > 10000) break;
      }
      if (findings.length > 10000) break;
    }

    return findings;
  }

  _collectFiles(dirPath) {
    const files = [];
    this._walkDir(dirPath, files);
    return files;
  }

  _walkDir(dir, files) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this._walkDir(fullPath, files);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SCAN_EXTENSIONS.has(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  _buildSummary(findings) {
    const summary = {};
    for (const f of findings) {
      if (!summary[f.category]) summary[f.category] = 0;
      summary[f.category]++;
    }
    return summary;
  }

  exportJson(scanResult, outputPath) {
    const report = {
      ...scanResult,
      exportedAt: new Date().toISOString(),
    };
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
    return outputPath;
  }

  exportHtml(scanResult, outputPath) {
    const html = this._buildHtmlReport(scanResult);
    fs.writeFileSync(outputPath, html, 'utf8');
    return outputPath;
  }

  _buildHtmlReport(scanResult) {
    const rows = scanResult.findings.map(f => {
      const sevColor = { critical: '#ff4444', high: '#ff8800', medium: '#ffcc00', low: '#88cc00' }[f.severity] || '#999';
      const loc = f.locations[0] || {};
      return `<tr>
        <td><span style="color:${sevColor}">${f.severity}</span></td>
        <td>${this._escHtml(f.category)}</td>
        <td>${this._escHtml(f.ruleName)}</td>
        <td><code>${this._escHtml(f.value)}</code></td>
        <td>${this._escHtml(loc.file || '')}:${loc.line || ''}</td>
      </tr>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Sensitive Info Scan Report</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #1a1a2e; color: #eee; padding: 20px; }
  h1 { color: #00d4ff; }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; }
  th, td { padding: 8px 12px; border: 1px solid #333; text-align: left; font-size: 13px; }
  th { background: #16213e; color: #00d4ff; }
  tr:nth-child(even) { background: #0f3460; }
  code { background: #333; padding: 2px 6px; border-radius: 3px; word-break: break-all; }
  .summary { display: flex; gap: 16px; flex-wrap: wrap; margin: 16px 0; }
  .summary-item { background: #16213e; padding: 12px 20px; border-radius: 8px; }
  .summary-item .count { font-size: 24px; font-weight: bold; color: #00d4ff; }
  .summary-item .label { font-size: 12px; color: #aaa; }
</style></head><body>
<h1>Sensitive Info Scan Report</h1>
<p>Directory: <code>${this._escHtml(scanResult.directory)}</code></p>
<p>Scanned: ${scanResult.scannedFiles} files | Found: ${scanResult.findings.length} items</p>
<div class="summary">
${Object.entries(scanResult.summary).map(([cat, count]) =>
  `<div class="summary-item"><div class="count">${count}</div><div class="label">${CATEGORY_LABELS[cat] || cat}</div></div>`
).join('\n')}
</div>
<table><thead><tr><th>Severity</th><th>Category</th><th>Rule</th><th>Value</th><th>Location</th></tr></thead>
<tbody>${rows}</tbody></table>
</body></html>`;
  }

  _escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  getCategoryLabel(key) {
    return CATEGORY_LABELS[key] || key;
  }
}

module.exports = SensitiveScanner;
