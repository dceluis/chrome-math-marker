import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    manifest_version: 3,
    name: "Math Marker",
    version: "1.0",
    description: "Add marks to any website",
    permissions: ["activeTab", "scripting", "storage", "tabs"],
    action: {},
    web_accessible_resources: [
      {
        resources: ["images/*.png"],
        matches: [ "<all_urls>" ]
      }
    ]
  },
  runner: {
    startUrls: ['https://notepad-plus-plus.org'],
  },
  outDirTemplate: "{{browser}}-mv{{manifestVersion}}{{modeSuffix}}"
});
