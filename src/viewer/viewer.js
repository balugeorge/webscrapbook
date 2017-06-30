/********************************************************************
 *
 * Script for viewer.html
 *
 *******************************************************************/

function initWithFileSystem(myFileSystem) {
  /**
   * common helper functions
   */
  var createDir = function (dirEntry, path, callback) {
    var folders = (Object.prototype.toString.call(path) === "[object Array]") ? path : path.split("/");
    dirEntry.getDirectory(folders.join("/"), {}, (dirEntry) => {
      callback();
    }, (ex) => {
      createDirInternal(dirEntry, folders, callback);
    });
  };

  var createDirInternal = function (dirEntry, folders, callback) {
    // Throw out './' or '/' and move on to prevent something like '/foo/.//bar'.
    if (folders[0] == '.' || folders[0] == '') {
      folders = folders.slice(1);
    }

    dirEntry.getDirectory(folders[0], {create: true}, (dirEntry) => {
      // Recursively add the new subfolder (if we still have another to create).
      if (folders.length) {
        createDir(dirEntry, folders.slice(1), callback);
      } else {
        callback();
      }
    }, (ex) => {
      alert("Unable to create directory: '" + folders.join("/") + "': " + ex);
    });
  };

  var createFile = function (dirEntry, path, fileBlob, callback) {
    createDir(dirEntry, path.split("/").slice(0, -1), () => {
      dirEntry.getFile(path, {create: true}, (fileEntry) => {
        // Create a FileWriter object for our FileEntry (log.txt).
        fileEntry.createWriter((fileWriter) => {

          fileWriter.onwriteend = function (e) {
            callback();
          };

          fileWriter.onerror = function (e) {
            alert("Unable to create write file: '" + path + "'");
            callback();
          };

          fileWriter.write(fileBlob);
        }, (ex) => {
          alert("Unable to create file writer: '" + path + "': " + ex);
        });
      }, (ex) => {
        alert("Unable to create file: '" + path + "': " + ex);
      });
    });
  };

  var extractZipFile = function (file) {
    var pendingZipEntry = 0;
    var ns = scrapbook.getUuid();
    var type = scrapbook.filenameParts(file.name)[1].toLowerCase();

    var zip = new JSZip();
    zip.loadAsync(file).then((zip) => {
      myFileSystem.root.getDirectory(ns, {create: true}, () => {
        zip.forEach((inZipPath, zipObj) => {
          if (zipObj.dir) { return; }
          ++pendingZipEntry;
          zipObj.async("arraybuffer").then((ab) => {
            createFile(myFileSystem.root, ns + "/" + inZipPath, new Blob([ab], {type: "text/plain"}), () => {
              if (--pendingZipEntry === 0) { onAllZipEntriesProcessed(type, ns); }
            });
          });
        });
        if (pendingZipEntry === 0) { onAllZipEntriesProcessed(type, ns); }
      }, (ex) => {
        alert("Unable to create directory: '" + ns + "': " + ex);
      });
    }).catch((ex) => {
      alert("Unable to load the zip file: " + ex);
    });
  };

  var onAllZipEntriesProcessed = function (type, ns) {
    switch (type) {
      case "maff": {
        var readRdfFile = function (file, callback) {
          var xhr = new XMLHttpRequest();
          xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
              if (xhr.status == 200 || xhr.status == 0) {
                callback(xhr.response);
              }
            }
          };
          xhr.responseType = "document";
          xhr.open("GET", URL.createObjectURL(file), true);
          xhr.send();
        };

        var processRdfDocument = function (doc) {
          var RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
          var MAF = "http://maf.mozdev.org/metadata/rdf#";
          var result = {};

          var elems = doc.getElementsByTagNameNS(MAF, "indexfilename");
          var elem = elems[0];
          if (elem) { result.indexfilename = elem.getAttributeNS(RDF, "resource"); }

          return result;
        };
        
        var processMaffDirectoryEntry = function (directoryEntry, callback) {
          directoryEntry.getFile("index.rdf", {}, (fileEntry) => {
            fileEntry.file((file) => {
              readRdfFile(file, (doc) => {
                var meta = processRdfDocument(doc);
                directoryEntry.getFile(meta.indexfilename, {}, (fileEntry) => {
                  callback(fileEntry);
                }, (ex) => {
                  alert("Unable to get index file '" + meta.indexfilename + "' in the directory: '" + directoryEntry.fullPath + "': " + ex);
                  callback(null);
                });
              });
            }, (ex) => {
              alert("Unable to read index.rdf in the directory: '" + directoryEntry.fullPath + "'");
              callback(null);
            });
          }, (ex) => {
            directoryEntry.createReader().readEntries((entries) => {
              for (let i = 0, I = entries.length; i < I; ++i) {
                let entry = entries[i];
                if (entry.isFile && entry.name.startsWith("index.")) {
                  callback(entry);
                  return;
                }
              }
              callback(null);
            }, (ex) => {
              alert("Unable to read directory: '" + directoryEntry.fullPath + "'");
              callback(null);
            });
          });
        };

        var onAllDirectoryParsed = function (indexFileEntries) {
          let validIndexFileEntries = indexFileEntries.filter(x => !!x);
          if (validIndexFileEntries.length) {
            onZipExtracted(validIndexFileEntries);
          } else {
            alert("No available data can be loaded from this maff file.");
          }
        };
        
        myFileSystem.root.getDirectory(ns, {}, (mainEntry) => {
          mainEntry.createReader().readEntries((entries) => {
            let remainingDirectories = 0, indexFileEntries = [];
            entries.forEach((entry) => {
              if (!entry.isDirectory) { return; }
              remainingDirectories++;
              let index = indexFileEntries.length;
              indexFileEntries.length++;
              processMaffDirectoryEntry(entry, (indexFileEntry) => {
                indexFileEntries[index] = indexFileEntry;
                if (--remainingDirectories === 0) { onAllDirectoryParsed(indexFileEntries); }
              });
            });
            if (remainingDirectories === 0) { onAllDirectoryParsed(indexFileEntries); }
          }, (ex) => {
            alert("Unable to read directory: '" + ns + "'");
          });
        }, (ex) => {
          alert("Unable to get directory: '" + ns + "'");
        });
        break;
      }
      case "htz":
      default: {
        var indexFile = ns + "/" + "index.html";
        myFileSystem.root.getFile(indexFile, {}, (fileEntry) => {
          onZipExtracted(fileEntry);
        }, (ex) => {
          alert("Unable to get file: '" + indexFile + "': " + ex);
        });
        break;
      }
    }
  };

  var onZipExtracted = function (indexFileEntries) {
    if (Object.prototype.toString.call(indexFileEntries) !== "[object Array]") {
      indexFileEntries = [indexFileEntries];
    }

    let url;
    indexFileEntries.forEach((indexFileEntry) => {
      url = loadEntry(indexFileEntry);
    });

    loadUrl(url);
  };

  var loadEntry = function (entry) {
    var url = entry.toURL() + urlSearch + urlHash;

    var docUrl = new URL(document.URL);
    var urlObj = new URL(url);
    docUrl.hash = urlObj.hash;
    urlObj.hash = "";
    docUrl.search = "?href=" + encodeURIComponent(urlObj.pathname.slice(1) + urlObj.search);
    history.pushState({}, null, docUrl.href);

    return url;
  };

  var loadUrl = function (url) {
    viewer.src = url;
    wrapper.style.display = 'block';
    fileSelector.style.display = 'none';
  };

  /**
   * main script
   */
  var fileSelector = document.getElementById('file-selector');
  var fileSelectorDrop = document.getElementById('file-selector-drop');
  var fileSelectorInput = document.getElementById('file-selector-input');
  var wrapper = document.getElementById('wrapper');
  var viewer = document.getElementById('viewer');
  var urlSearch = "";
  var urlHash = "";

  fileSelectorDrop.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, false);

  fileSelectorDrop.addEventListener("drop", (e) => {
    e.preventDefault();

    Array.prototype.forEach.call(e.dataTransfer.items, (item) => {
      var entry = item.webkitGetAsEntry();
      if (entry.isFile) {
        entry.file((file) => {
          extractZipFile(file);
        });
      }
    });
  }, false);

  fileSelectorDrop.addEventListener("click", (e) => {
    e.preventDefault();
    fileSelectorInput.click();
  }, false);

  fileSelectorInput.addEventListener("change", (e) => {
    e.preventDefault();
    var file = e.target.files[0];
    extractZipFile(file);
  }, false);

  viewer.addEventListener("load", (e) => {
    document.title = viewer.contentDocument.title;
  });

  // if source is specified, load it
  let mainUrl = new URL(document.URL);

  let href = mainUrl.searchParams.get("href");
  if (href) {
    let url = new URL(href, "file://");
    myFileSystem.root.getFile(url.pathname, {}, (indexFileEntry) => {
      let targetUrl = indexFileEntry.toURL() + url.search + mainUrl.hash;
      loadUrl(targetUrl);
    }, (ex) => {
      alert("Unable to load file: '" + href + "': " + ex);
    });
    return;
  }

  let src = mainUrl.searchParams.get("src");
  if (src) {
    try {
      let srcUrl = new URL(src);
      urlSearch = srcUrl.search;
      urlHash = mainUrl.hash;
      // use a random hash to avoid recursive redirect
      srcUrl.searchParams.set(scrapbook.runtime.viewerRedirectKey, 1);
      src = srcUrl.toString();
      let filename = scrapbook.urlToFilename(src);

      let xhr = new XMLHttpRequest();

      xhr.onreadystatechange = function () {
        if (xhr.readyState === 2) {
          // if header Content-Disposition is defined, use it
          try {
            let headerContentDisposition = xhr.getResponseHeader("Content-Disposition");
            let contentDisposition = scrapbook.parseHeaderContentDisposition(headerContentDisposition);
            filename = contentDisposition.parameters.filename || filename;
          } catch (ex) {}
        } else if (xhr.readyState === 4) {
          if (xhr.status == 200 || xhr.status == 0) {
            let file = new File([xhr.response], filename);
            extractZipFile(file);
          }
        }
      };

      xhr.responseType = "blob";
      xhr.open("GET", src, true);
      xhr.send();
    } catch (ex) {
      alert("Unable to load the specified zip file '" + src + "': " + ex);
    }
    return;
  }
}

function initWithoutFileSystem() {
  var extractedfiles = {};
  var virtualBase = chrome.runtime.getURL("viewer/!/");

  /**
   * common helper functions
   */
  var extractZipFile = function (file, callback) {
    var pendingZipEntry = 0;
    var type = scrapbook.filenameParts(file.name)[1].toLowerCase();

    var zip = new JSZip();
    zip.loadAsync(file).then((zip) => {
      zip.forEach((relativePath, zipObj) => {
        if (zipObj.dir) { return; }
        ++pendingZipEntry;
        zipObj.async("arraybuffer").then((ab) => {
          let mime = Mime.prototype.lookup(relativePath);
          extractedfiles[relativePath] = new File([ab], scrapbook.urlToFilename(relativePath), {type: mime});
          if (--pendingZipEntry === 0) { onAllZipEntriesProcessed(type, callback); }
        });
      });
      if (pendingZipEntry === 0) { onAllZipEntriesProcessed(type, callback); }
    }).catch((ex) => {
      alert("Unable to load the zip file: " + ex);
    });
  };

  var onAllZipEntriesProcessed = function (type, callback) {
    switch (type) {
      case "maff": {
        break;
      }
      case "htz":
      default: {
        var indexFile = "index.html";
        callback(indexFile);
        break;
      }
    }
  };

  var onZipExtracted = function (indexFilePath) {
    loadFile(indexFilePath);
  };

  var loadFile = function (relativePath) {
    var file = extractedfiles[relativePath];
    var reader = new FileReader();
    reader.addEventListener("loadend", () => {
      var content = reader.result;
      var parser = new DOMParser();
      var doc = parser.parseFromString(content, "text/html");
      updateFrameContent(doc);
      wrapper.style.display = 'block';
      fileSelector.style.display = 'none';
    });
    reader.readAsText(file, "UTF-8");
  };

  var updateFrameContent = function (doc) {
    // helper functions
    var rewriteUrl = function (url) {
      var absoluteUrl = new URL(url, virtualBase);
      if (absoluteUrl.href.startsWith(virtualBase)) {
        var search = absoluteUrl.search;
        var hash = absoluteUrl.hash;
        absoluteUrl.search = "";
        absoluteUrl.hash = "";
        var relativePath = absoluteUrl.href.slice(virtualBase.length);
        relativePath = relativePath.split("/").map(x => decodeURIComponent(x)).join("/");
        if (extractedfiles[relativePath]) {
          return URL.createObjectURL(extractedfiles[relativePath]) + search + hash;
        }
      }
      return absoluteUrl.href;
    };
    
    // modify base
    Array.prototype.forEach.call(doc.querySelectorAll("base"), (elem) => {
      elem.parentNode.removeChild(elem);
    });
    var baseElem = doc.createElement("base");
    baseElem.href = virtualBase;
    doc.querySelector("head").appendChild(baseElem);

    // modify URLs
    Array.prototype.forEach.call(doc.querySelectorAll("*"), (elem) => {
      // skip elements that are already removed from the DOM tree
      if (!elem.parentNode) { return; }

      switch (elem.nodeName.toLowerCase()) {
        case "meta": {
          if (elem.hasAttribute("property") && elem.hasAttribute("content")) {
            switch (elem.getAttribute("property").toLowerCase()) {
              case "og:image":
              case "og:image:url":
              case "og:image:secure_url":
              case "og:audio":
              case "og:audio:url":
              case "og:audio:secure_url":
              case "og:video":
              case "og:video:url":
              case "og:video:secure_url":
              case "og:url":
                elem.setAttribute("content", rewriteUrl(elem.getAttribute("content")));
                break;
            }
          }
          break;
        }

        // @TODO: content of the target should be parsed
        case "link": {
          if (elem.hasAttribute("href")) {
            elem.setAttribute("href", rewriteUrl(elem.href));
          }
          break;
        }

        // @TODO: content should be parsed
        case "style": {
          break;
        }

        case "script": {
          if (elem.hasAttribute("src")) {
            elem.setAttribute("src", rewriteUrl(elem.src));
          }
          break;
        }

        case "body":
        case "table":
        case "tr":
        case "th":
        case "td": {
          // deprecated: background attribute (deprecated since HTML5)
          if (elem.hasAttribute("background")) {
            elem.setAttribute("background", rewriteUrl(elem.getAttribute("background")));
          }
          break;
        }

        // @TODO: content of the target should be parsed
        case "frame":
        case "iframe": {
          if (elem.hasAttribute("src")) {
            elem.setAttribute("src", rewriteUrl(elem.src));
          }
          break;
        }

        // @TODO: content of the target should be parsed
        case "a":
        case "area": {
          if (elem.hasAttribute("href")) {
            elem.setAttribute("href", rewriteUrl(elem.href));
          }
          break;
        }

        case "img": {
          if (elem.hasAttribute("src")) {
            elem.setAttribute("src", rewriteUrl(elem.src));
          }
          if (elem.hasAttribute("srcset")) {
            elem.setAttribute("srcset",
              scrapbook.parseSrcset(elem.getAttribute("srcset"), (url) => {
                return rewriteUrl(url);
              })
            );
          }
          break;
        }

        case "source": {
          if (elem.hasAttribute("srcset")) {
            elem.setAttribute("srcset",
              scrapbook.parseSrcset(elem.getAttribute("srcset"), (url) => {
                return rewriteUrl(url);
              })
            );
          }
          break;
        }

        case "embed": {
          if (elem.hasAttribute("src")) {
            elem.setAttribute("src", rewriteUrl(elem.src));
          }
          break;
        }

        case "object": {
          if (elem.hasAttribute("data")) {
            elem.setAttribute("data", rewriteUrl(elem.data));
          }
          break;
        }

        case "applet": {
          if (elem.hasAttribute("archive")) {
            elem.setAttribute("archive", rewriteUrl(elem.getAttribute("archive")));
          }
          break;
        }

        case "form": {
          if ( elem.hasAttribute("action") ) {
            elem.setAttribute("action", rewriteUrl(elem.action));
          }
          break;
        }

        case "input": {
          switch (elem.type.toLowerCase()) {
            // images: input
            case "image":
              if (elem.hasAttribute("src")) {
                elem.setAttribute("src", rewriteUrl(elem.src));
              }
              break;
          }
          break;
        }
      }
    });

    // flush content
    var content = scrapbook.doctypeToString(doc.doctype) + doc.documentElement.outerHTML;
    viewer.src = URL.createObjectURL(new Blob([content], {type: "text/html"}));
  };

  /**
   * main script
   */
  var fileSelector = document.getElementById('file-selector');
  var fileSelectorDrop = document.getElementById('file-selector-drop');
  var fileSelectorInput = document.getElementById('file-selector-input');
  var wrapper = document.getElementById('wrapper');
  var viewer = document.getElementById('viewer');
  var urlSearch = "";
  var urlHash = "";

  fileSelectorDrop.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, false);

  fileSelectorDrop.addEventListener("drop", (e) => {
    e.preventDefault();

    Array.prototype.forEach.call(e.dataTransfer.items, (item) => {
      var entry = item.webkitGetAsEntry();
      if (entry.isFile) {
        entry.file((file) => {
          extractZipFile(file, onZipExtracted);
        });
      }
    });
  }, false);

  fileSelectorDrop.addEventListener("click", (e) => {
    e.preventDefault();
    fileSelectorInput.click();
  }, false);

  fileSelectorInput.addEventListener("change", (e) => {
    e.preventDefault();
    var file = e.target.files[0];
    extractZipFile(file, onZipExtracted);
  }, false);

  viewer.addEventListener("load", (e) => {
    var doc = viewer.contentDocument;
    document.title = doc.title;
  });

  // if source is specified, load it
  let mainUrl = new URL(document.URL);

  let href = mainUrl.searchParams.get("href");
  if (href) {
    alert("Unable to load file: '" + href + "': " + ex);
  }

  let src = mainUrl.searchParams.get("src");
  if (src) {
    try {
      let srcUrl = new URL(src);
      urlSearch = srcUrl.search;
      urlHash = mainUrl.hash;
      // use a random hash to avoid recursive redirect
      srcUrl.searchParams.set(scrapbook.runtime.viewerRedirectKey, 1);
      src = srcUrl.toString();
      let filename = scrapbook.urlToFilename(src);

      let xhr = new XMLHttpRequest();

      xhr.onreadystatechange = function () {
        if (xhr.readyState === 2) {
          // if header Content-Disposition is defined, use it
          try {
            let headerContentDisposition = xhr.getResponseHeader("Content-Disposition");
            let contentDisposition = scrapbook.parseHeaderContentDisposition(headerContentDisposition);
            filename = contentDisposition.parameters.filename || filename;
          } catch (ex) {}
        } else if (xhr.readyState === 4) {
          if (xhr.status == 200 || xhr.status == 0) {
            let file = new File([xhr.response], filename);
            extractZipFile(file, onZipExtracted);
          }
        }
      };

      xhr.responseType = "blob";
      xhr.open("GET", src, true);
      xhr.send();
    } catch (ex) {
      alert("Unable to load the specified zip file '" + src + "': " + ex);
    }
    return;
  }
}

document.addEventListener("DOMContentLoaded", function () {
  // load languages
  scrapbook.loadLanguages(document);
  
  scrapbook.loadOptions(() => {
    // request FileSystem
    var errorHandler = function (ex) {
      // console.error(ex);
      initWithoutFileSystem();
    };

    try {
      if (scrapbook.options["viewer.useFileSystemApi"]) {
        window.requestFileSystem = window.requestFileSystem || window.webkitRequestFileSystem;
        // @TODO: Request a 5GB filesystem currently. Do we need larger space or make it configurable?
        window.requestFileSystem(window.TEMPORARY, 5*1024*1024*1024, (fs) => {
          initWithFileSystem(fs);
        }, errorHandler);
      } else {
        initWithoutFileSystem();
      }
    } catch (ex) {
      errorHandler(ex);
    }
  });
});