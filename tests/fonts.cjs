module.exports = new Proxy({}, {
  get(_target, url) {
    const family = String(url).match(/family=([^:&]+)/)?.[1]?.replace(/\+/g, " ") || "Mock Font";
    return `@font-face { font-family: '${family}'; src: url(mock-font-data) format('woff2'); font-weight: 100 900; }`;
  },
});
