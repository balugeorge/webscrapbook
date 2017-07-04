/********************************************************************
 *
 * Shared functions for most scripts, including background scripts and
 * content scripts.
 *
 * @public {Object} scrapbook
 *******************************************************************/

var scrapbook = {};
var isDebug = false;


/********************************************************************
 * Catch several environment information so that we can get it
 * synchronously later.  Note that there may be a delay before they 
 * can be loaded.
 *******************************************************************/

scrapbook.runtime = {
  isGecko: false,
  viewerRedirectKey: "kwo7vzrTJ9btCVZ"
};

{
  let manifest = chrome.runtime.getManifest();
  scrapbook.runtime.isGecko = manifest.applications && manifest.applications.gecko;
}


/********************************************************************
 * Options
 *******************************************************************/

scrapbook.options = {
  "capture.dataFolder": "WebScrapBook",
  "capture.saveAs": ["downloads", "zip", "maff", "singleHtml", 1],
  "capture.savePrompt": false,
  "capture.saveAsciiFilename": false,
  "capture.saveSelectionOnly": true,
  "capture.saveInlineAsHtml": false,
  "capture.saveDataUriAsFile": false,
  "capture.favicon": ["save", "link", "blank", "remove", 0],
  "capture.image": ["save", "link", "blank", "remove", 0],
  "capture.imageBackground": ["save", "link", "remove", 0],
  "capture.audio": ["save", "link", "blank", "remove", 0],
  "capture.video": ["save", "link", "blank", "remove", 0],
  "capture.embed": ["save", "link", "blank", "remove", 0],
  "capture.object": ["save", "link", "blank", "remove", 0],
  "capture.applet": ["save", "link", "blank", "remove", 0],
  "capture.canvas": ["save", "blank", "remove", 0],
  "capture.frame": ["save", "link", "blank", "remove", 0],
  "capture.font": ["save", "link", "blank", "remove", 0],
  "capture.style": ["save", "link", "blank", "remove", 0],
  "capture.styleInline": ["save", "blank", "remove", 0],
  "capture.rewriteCss": ["none", "url", 1],
  "capture.script": ["save", "link", "blank", "remove", 2],
  "capture.scriptAnchor": ["save", "blank", "remove", 1],
  "capture.scriptAttr": ["save", "remove", 1],
  "capture.noscript": ["save", "blank", "remove", 0],
  "capture.base": ["save", "blank", "remove", 1],
  "capture.removeIntegrity": true,
  "capture.recordDocumentMeta": true,
  "capture.recordRemovedNode": false,
  "capture.recordRemovedAttr": false,
  "capture.recordSourceUri": false,
  "capture.recordErrorUri": true,
};

scrapbook.isOptionsSynced = false;

scrapbook.getOption = function (key, defaultValue) {
  var result = scrapbook.options[key];
  if (result === undefined) {
    result = defaultValue;
  }
  return result;
};

scrapbook.getOptions = function (keyPrefix) {
  var result = {};
  var regex = new RegExp("^" + scrapbook.escapeRegExp(keyPrefix) + ".");
  for (let key in scrapbook.options) {
    if (regex.test(key)) {
      result[key] = scrapbook.getOption(key);
    }
  }
  return result;
};

scrapbook.setOption = function (key, value, callback) {
  scrapbook.options[key] = value;
  chrome.storage.sync.set({key: value}, () => {
    if (callback) {
      callback({key: value});
    }
  });
};

scrapbook.loadOptions = function (callback) {
  chrome.storage.sync.get(scrapbook.options, (items) => {
    for (let i in items) {
      var item = items[i];
      if (Object.prototype.toString.call(item) === "[object Array]") {
        scrapbook.options[i] = item[item.pop()];
      } else {
        scrapbook.options[i] = item;
      }
    }
    if (callback) {
      scrapbook.isOptionsSynced = true;
      callback(scrapbook.options);
    }
  });
};

scrapbook.saveOptions = function (callback) {
  chrome.storage.sync.set(scrapbook.options, () => {
    if (callback) {
      callback(scrapbook.options);
    }
  });
};


/********************************************************************
 * Lang
 *******************************************************************/

scrapbook.lang = function (key, args) {
  return chrome.i18n.getMessage(key, args) || "__MSG_" + key + "__";
};

scrapbook.loadLanguages = function (rootNode) {
  Array.prototype.forEach.call(rootNode.getElementsByTagName("*"), (elem) => {
    var str = elem.textContent;
    if (/^__MSG_(.*?)__$/.test(str)) {
      elem.textContent = scrapbook.lang(RegExp.$1);
    }
    Array.prototype.forEach.call(elem.attributes, (attr) => {
      if (/^__MSG_(.*?)__$/.test(attr.nodeValue)) {
        attr.nodeValue = scrapbook.lang(RegExp.$1);
      }
    }, this);
  }, this);
};


/********************************************************************
 * ScrapBook related path/file/string/etc handling
 *******************************************************************/

/**
 * Escapes the given filename string to be used in the URI
 *
 * Preserves other chars for beauty
 *
 * see also: validateFilename
 */
scrapbook.escapeFilename = function (filename) {
  return filename.replace(/[ %#]+/g, m => encodeURIComponent(m));
};

/**
 * Transliterates the given string to be a safe filename
 *
 * see also: escapeFileName
 *
 * @param {string} filename
 * @param {boolean} forceAscii - also escapes all non-ASCII chars
 */
scrapbook.validateFilename = function (filename, forceAscii) {
  var fn = filename
      // control chars are bad for filename
      .replace(/[\x00-\x1F\x7F]+|^ +/g, "")
      // leading/trailing spaces and dots are not allowed in Windows
      .replace(/^\./, "_.").replace(/^ +/, "").replace(/[. ]+$/, "")
      // bad chars in most OS
      .replace(/[:"?*\\/|]/g, "_")
      // "~" is not allowed by Chromium downloader
      .replace(/[~]/g, "-").replace(/[<]/g, "(").replace(/[>]/g, ")");
  if (forceAscii) {
    fn = fn.replace(/[^\x00-\x7F]+/g, m => encodeURIComponent(m));
  }
  fn = fn || "_"; // prevent empty filename
  return fn;
};

scrapbook.urlToFilename = function (url) {
  var name = url, pos;
  pos = name.indexOf("?");
  if (pos !== -1) { name = name.substring(0, pos); }
  pos = name.indexOf("#");
  if (pos !== -1) { name = name.substring(0, pos); }
  pos = name.lastIndexOf("/");
  if (pos !== -1) { name = name.substring(pos + 1); }

  // decode %xx%xx%xx only if it's correctly UTF-8 encoded
  // @TODO: decode using a specified charset
  try {
    name = decodeURIComponent(name);
  } catch (ex) {}
  return name;
};

scrapbook.splitUrl = function (url) {
  var name = url, search = "", hash = "", pos;
  pos = name.indexOf("#");
  if (pos !== -1) { hash = name.slice(pos); name = name.slice(0, pos); }
  pos = name.indexOf("?");
  if (pos !== -1) { search = name.slice(pos); name = name.slice(0, pos); }
  return [name, search, hash];
};

scrapbook.splitUrlByAnchor = function (url) {
  var [name, search, hash] = scrapbook.splitUrl(url);
  return [name + search, hash];
};

scrapbook.filenameParts = function (filename) {
  var pos = filename.lastIndexOf(".");
  if (pos != -1) {
    return [filename.substring(0, pos), filename.substring(pos + 1, filename.length)];
  }
  return [filename, ""];
};

/**
 * Returns the ScrapBook ID from a given Date object
 *
 * @param  {Date|undefined} date - Given day, or now if undefined
 * @return {string} the ScrapBook ID
 */
scrapbook.dateToId = function (date) {
  var dd = date || new Date();
  return dd.getUTCFullYear() +
      this.intToFixedStr(dd.getUTCMonth() + 1, 2) +
      this.intToFixedStr(dd.getUTCDate(), 2) +
      this.intToFixedStr(dd.getUTCHours(), 2) +
      this.intToFixedStr(dd.getUTCMinutes(), 2) +
      this.intToFixedStr(dd.getUTCSeconds(), 2) +
      this.intToFixedStr(dd.getUTCMilliseconds(), 3);
};

/**
 * @param {Date} id - Given ScrapBook ID
 */
scrapbook.idToDate = function (id) {
  var dd;
  if (id.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{3})$/)) {
    dd = new Date(
        parseInt(RegExp.$1, 10), parseInt(RegExp.$2, 10) - 1, parseInt(RegExp.$3, 10),
        parseInt(RegExp.$4, 10), parseInt(RegExp.$5, 10), parseInt(RegExp.$6, 10), parseInt(RegExp.$7, 10)
        );
    dd.setTime(dd.valueOf() - dd.getTimezoneOffset() * 60 * 1000);
  }
  return dd;
};

/**
 * Returns the ScrapBook ID from a given Date object
 *
 * @deprecated Used by older ScrapBook 1.x, may get inaccurate if used across different timezone
 * @param {Date|undefined} date - Given day, or now if undefined
 * @return {string} the ScrapBook ID
 */
scrapbook.dateToIdOld = function (date) {
  var dd = date || new Date();
  return dd.getFullYear() +
      this.intToFixedStr(dd.getMonth() + 1, 2) +
      this.intToFixedStr(dd.getDate(), 2) +
      this.intToFixedStr(dd.getHours(), 2) +
      this.intToFixedStr(dd.getMinutes(), 2) +
      this.intToFixedStr(dd.getSeconds(), 2);
};

/**
 * @deprecated Used by older ScrapBook 1.x, may get inaccurate if used across different timezone
 * @param {Date} id - Given ScrapBook ID
 */
scrapbook.idToDateOld = function (id) {
  var dd;
  if (id.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/)) {
    dd = new Date(
        parseInt(RegExp.$1, 10), parseInt(RegExp.$2, 10) - 1, parseInt(RegExp.$3, 10),
        parseInt(RegExp.$4, 10), parseInt(RegExp.$5, 10), parseInt(RegExp.$6, 10)
        );
  }
  return dd;
};


/********************************************************************
 * String handling
 *******************************************************************/

/**
 * Crops the given string
 *
 * @param {boolean} byUtf8   - true to crop texts according to each byte under UTF-8 encoding
 *                             false to crop according to each UTF-16 char
 * @param {boolean} ellipsis - string for ellipsis
 */
scrapbook.crop = function (str, maxLength, byUtf8, ellipsis) {
  if (typeof ellipsis  === "undefined") { ellipsis = "..."; }
  if (byUtf8) {
    var bytes = this.unicodeToUtf8(str);
    if (bytes.length <= maxLength) { return str; }
    bytes = bytes.substring(0, maxLength - this.unicodeToUtf8(ellipsis).length);
    while (true) {
      try {
        return this.utf8ToUnicode(bytes) + ellipsis;
      } catch (ex) {}
      bytes= bytes.substring(0, bytes.length-1);
    }
  } else {
    return (str.length > maxLength) ? str.substr(0, maxLength - ellipsis.length) + ellipsis : str;
  }
};

scrapbook.getUuid = function () {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    var r = Math.random()*16|0, v = (c == 'x') ? r : (r&0x3|0x8);
    return v.toString(16);
  });
};

scrapbook.escapeHtml = function (str, noDoubleQuotes, singleQuotes, spaces) {
  var list = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': (noDoubleQuotes ? '"' : "&quot;"),
    "'": (singleQuotes ? "&#39;" : "'"),
    " ": (spaces ? "&nbsp;" : " ")
  };
  return str.replace(/[&<>"']| (?= )/g, m => list[m]);
};

scrapbook.escapeRegExp = function (str) {
  return str.replace(/([\*\+\?\.\^\/\$\\\|\[\]\{\}\(\)])/g, "\\$1");
};

scrapbook.escapeHtmlComment = function (str) {
  return str.replace(/-([\u200B]*)-/g, "-\u200B$1-");
};

scrapbook.escapeQuotes = function (str) {
  return str.replace(/[\\"]/g, "\\$&");
};

scrapbook.unescapeCss = function (str) {
  var that = arguments.callee;
  if (!that.replaceRegex) {
    that.replaceRegex = /\\([0-9A-Fa-f]{1,6}) ?|\\(.)/g;
    that.getCodes = function (n) {
      if (n < 0x10000) return [n];
      n -= 0x10000;
      return [0xD800+(n>>10), 0xDC00+(n&0x3FF)];
    };
    that.replaceFunc = function (m, u, c) {
      if (c) return c;
      if (u) return String.fromCharCode.apply(null, that.getCodes(parseInt(u, 16)));
    };
  }
  return str.replace(that.replaceRegex, that.replaceFunc);
};

scrapbook.decodeURIComponent = function (uri) {
  // A URL containing standalone "%"s causes a malformed URI sequence error.
  return uri.replace(/(%[0-9A-F]{2})+/gi, m => decodeURIComponent(m));
};

scrapbook.stringToDataUri = function (str, mime, charset) {
  mime = mime || "";
  charset = charset ? ";charset=" + charset : "";
  return "data:" + mime + charset + ";base64," + this.unicodeToBase64(str);
};

scrapbook.dataUriToFile = function (dataUri) {
  if (dataUri.startsWith("data:")) {
    dataUri = dataUri.slice(5);

    if (/^(.*?),(.*?)$/.test(dataUri)) {
      var metas = RegExp.$1.split(";");
      var data = RegExp.$2;
      var mime = metas.shift();
      var base64 = false;
      var parameters = {};

      metas.forEach((meta) => {
        if (/^(.*?)=(.*?)$/.test(meta)) {
          parameters[RegExp.$1.toLowerCase()] = RegExp.$2;
        } else if (meta == "base64") {
          base64 = true;
        }
      }, this);

      var ext = Mime.prototype.extension(mime);
      ext = ext ? ("." + ext) : "";

      if (base64) {
        var bstr = atob(data), ab = scrapbook.byteStringToArrayBuffer(bstr);
        var filename = scrapbook.sha1(ab, "ARRAYBUFFER") + ext;
        var file = new File([ab], filename, {type: mime});
      } else {
        var charset = (parameters.charset || "US-ASCII").toLowerCase();
        switch (charset) {
          case "us-ascii":
            var str = unescape(data);
            var filename = scrapbook.sha1(str, "BYTES") + ext;
            var file = new File([str], filename, {type: mime});
            break;
          case "utf-8":
            var str = decodeURIComponent(data);
            var filename = scrapbook.sha1(str, "TEXT") + ext;
            var file = new File([str], filename, {type: mime});
            break;
          default:
            console.error('Unsupported charset in data URI: ' + charset);
            file = null;
            break;
        }
      }
      return file;
    }
  }
  return null;
};

scrapbook.unicodeToUtf8 = function (chars) {
  return unescape(encodeURIComponent(chars));
};

scrapbook.utf8ToUnicode = function (bytes) {
  return decodeURIComponent(escape(bytes));
};

scrapbook.unicodeToBase64 = function (str) {
  return btoa(unescape(encodeURIComponent(str)));
};

scrapbook.base64ToUnicode = function (str) {
  return decodeURIComponent(escape(atob(str)));
};

/**
 * supported data types: "B64", "BYTES", "TEXT", "ARRAYBUFFER"
 *
 * @require jsSHA
 */
scrapbook.sha1 = function (data, type) {
  var shaObj = new jsSHA("SHA-1", type);
  shaObj.update(data);
  return shaObj.getHash("HEX");
};

scrapbook.intToFixedStr = function (number, width, padder) {
  padder = padder || "0";
  number = number.toString(10);
  return number.length >= width ? number : new Array(width - number.length + 1).join(padder) + number;
};

scrapbook.byteStringToArrayBuffer = function (bstr) {
  return new TextEncoder("utf-8").encode(bstr).buffer;
};

scrapbook.arrayBufferToByteString = function (ab) {
  return new TextDecoder("utf-8").decode(new Uint8Array(ab));
};


/********************************************************************
 * String handling - HTML Header parsing
 *******************************************************************/

/**
 * Parse Content-Type string from the HTTP Header
 *
 * @return {{contentType: string, charset: string}}
 */
scrapbook.parseHeaderContentType = function (string) {
  var match = string.match(/^\s*(.*?)(?:\s*;\s*charset\s*=\s*(.*?))?$/i);
  return {contentType: match[1], charset: match[2]};
};

/**
 * Parse Content-Disposition string from the HTTP Header
 *
 * ref: https://github.com/jshttp/content-disposition/blob/master/index.js
 *
 * @param {string} string - The string to parse, not including "Content-Disposition: "
 * @return {{type: ('inline'|'attachment'), parameters: {[filename: string]}}}
 */
scrapbook.parseHeaderContentDisposition = function (string) {
  var result = {type: undefined, parameters: {}};

  if (!string || typeof string !== 'string') {
    return result;
  }

  var parts = string.split(";");
  result.type = parts.shift().trim();

  parts.forEach((part) => {
    if (/^(.*?)=(.*?)$/.test(part)) {
      var field = RegExp.$1.trim();
      var value = RegExp.$2.trim();

      // manage double quoted value
      if (/^"(.*?)"$/.test(value)) {
        value = RegExp.$1;
      }

      if (/^(.*)\*$/.test(field)) {
        // ext-value
        field = RegExp.$1;
        if (/^(.*?)'(.*?)'(.*?)$/.test(value)) {
          var charset = RegExp.$1.toLowerCase(), lang = RegExp.$2.toLowerCase(), value = RegExp.$3;
          switch (charset) {
            case 'iso-8859-1':
              value = decodeURIComponent(value).replace(/[^\x20-\x7e\xa0-\xff]/g, "?");
              break;
            case 'utf-8':
              value = decodeURIComponent(value);
              break;
            default:
              console.error('Unsupported charset in the extended field of header content-disposition: ' + charset);
              return;
          }
        };
      }
      result.parameters[field] = value;
    }
  }, this);

  return result;
};


/********************************************************************
 * HTML DOM related utilities
 *******************************************************************/

scrapbook.doctypeToString = function (doctype) {
  if (!doctype) { return ""; }
  var ret = "<!DOCTYPE " + doctype.name;
  if (doctype.publicId) { ret += ' PUBLIC "' + doctype.publicId + '"'; }
  if (doctype.systemId) { ret += ' "'        + doctype.systemId + '"'; }
  ret += ">\n";
  return ret;
};

/**
 * The function that rewrites each URL into a new URL.
 *
 * @callback parseSrcsetRewriteFunc
 * @param {string} url
 * @return {string} newUrl
 */

/**
 * @param {string} srcset
 * @param {parseSrcsetRewriteFunc} rewriteFunc
 */
scrapbook.parseSrcset = function (srcset, rewriteFunc) {
  return srcset.replace(/(\s*)([^ ,][^ ]*[^ ,])(\s*(?: [^ ,]+)?\s*(?:,|$))/g, (m, m1, m2, m3) => {
    return m1 + rewriteFunc(m2) + m3;
  });
};


/********************************************************************
 * Network utilities
 *******************************************************************/

/**
 * The callback function that aborts the XMLHttpRequest when called.
 *
 * @callback xhrAbortCallback
 */

/**
 * @callback xhrEventHandler
 * @param {XMLHttpRequest} xhr
 * @param {xhrAbortCallback} xhrAbort
 */

/**
 * A simple XMLHttpRequest wrapper for most common tasks
 *
 * @param {Object} params
 *     - {string} params.url
 *     - {string} params.responseType
 *     - {xhrEventHandler} params.onreadystatechange
 *     - {xhrEventHandler} params.onloadend
 *     - {xhrEventHandler} params.onerror
 *     - {xhrEventHandler} params.ontimeout
 */
scrapbook.xhr = function (params) {
  var xhr = new XMLHttpRequest();

  var xhrAbort = function () {
    xhr.onreadystatechange = xhr.onerror = xhr.ontimeout = null;
    xhr.abort();
  };

  xhr.onreadystatechange = function () {
    params && params.onreadystatechange && params.onreadystatechange(xhr, xhrAbort);
  };

  xhr.onloadend = function () {
    params && params.onloadend && params.onloadend(xhr, xhrAbort);
  };

  xhr.onerror = function () {
    params && params.onerror && params.onerror(xhr, xhrAbort);
  };

  xhr.ontimeout = function () {
    var handler = params && params.ontimeout || params.onerror;
    handler && handler(xhr, xhrAbort);
  };

  try {
    xhr.responseType = params.responseType;
    xhr.open("GET", params.url, true);
    xhr.send();
  } catch (ex) {
    console.error(ex);
    xhr.onerror();
  }
};
