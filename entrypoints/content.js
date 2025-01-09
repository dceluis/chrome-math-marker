import { storage } from 'wxt/storage';

// import "url:https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg-full.js"
import "~/utils/tex-svg-custom.min.js"
import "~/assets/styles.css"

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'iconClicked') {
    injectAndRunMarkerToolbar();
  }
});

if(import.meta.env.DEV === true) {
  injectAndRunMarkerToolbar();
}

const ENABLE_CLIP_TOOL = !!import.meta.env.WXT_ENABLE_CLIP_TOOL
const CLIP_TOOL_ENDPOINT = import.meta.env.WXT_CLIP_TOOL_ENDPOINT

function getElements() {
  return JSON.parse(JSON.stringify(window.markerToolbarState.undoStack[window.markerToolbarState.undoStack.length - 1] || []));
}

function toggleExtension() {
  const enabled = !window.markerToolbarState.enabled;

  window.markerToolbarState.enabled = enabled;

  if (!enabled) {
    window.markerToolbarState.disabledAt = Date.now();
  } else {
    window.markerToolbarState.disabledAt = null;
  }

  window.markerToolbarState.toolbar.style.display = window.markerToolbarState.enabled ? "block" : "none";
  window.markerToolbarState.canvas.style.display = window.markerToolbarState.enabled ? "block" : "none";
}

function initToolbar() {
  if (!window.markerToolbarState.toolbar) {
    window.markerToolbarState.toolbar = document.createElement('div');
    window.markerToolbarState.toolbar.id = 'marker-toolbar';
    window.markerToolbarState.toolbar.innerHTML = `
      <div id="color-picker" style="margin-bottom: 10px;">
        <label for="color">COLOR</label>
        <input type="color" id="color" value="#FF0000">
      </div>
      <div id="size-slider" style="margin-bottom: 10px;">
        <label for="size">SIZE</label>
        <input type="range" id="size" min="1" max="60" value="5">
      </div>
      <div id="tools" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 5px;">
        <button class="tool" data-tool="pen"><img src="${browser.runtime.getURL('/images/pencil-line.png')}" alt="Pen" /></button>
        <button class="tool" data-tool="cursor"><img src="${browser.runtime.getURL('/images/mouse-pointer-2.png')}" alt="Cursor" /></button>
        <button class="tool" data-tool="highlighter"><img src="${browser.runtime.getURL('/images/highlighter.png')}" alt="Highlighter" /></button>
        <button class="tool" data-tool="move"><img src="${browser.runtime.getURL('/images/move.png')}" alt="Move" /></button>
        <button class="tool" data-tool="line"><img src="${browser.runtime.getURL('/images/ruler.png')}" alt="Line" /></button>
        <button class="tool" data-tool="eraser"><img src="${browser.runtime.getURL('/images/eraser.png')}" alt="Eraser" /></button>
        <button class="tool" data-tool="mathjax"><img src="${browser.runtime.getURL('/images/square-function.png')}" alt="Mathjax" /></button>
        <button class="tool" data-tool="text"><img src="${browser.runtime.getURL('/images/type.png')}" alt="Text" /></button>
        <button class="action" data-action="undo"><img src="${browser.runtime.getURL('/images/undo.png')}" alt="Undo" /></button>
        <button class="action" data-action="redo"><img src="${browser.runtime.getURL('/images/redo.png')}" alt="Redo" /></button>
        <button class="action" data-action="delete"><img src="${browser.runtime.getURL('/images/trash-2.png')}" alt="Delete" /></button>
        <button class="action" data-action="exit"><img src="${browser.runtime.getURL('/images/log-out.png')}" alt="Exit" /></button>
        ${ ENABLE_CLIP_TOOL ? `<button class="tool" data-tool="clip"><img src="${browser.runtime.getURL('/images/scan.png')}" alt="Clip" /></button>` : ""}
      </div>
      <div id="console"></div>
    `;
    document.body.appendChild(window.markerToolbarState.toolbar);

    document.getElementById('color').addEventListener('change', updateColor);
    document.getElementById('size').addEventListener('input', updateSize);
    window.markerToolbarState.toolbar.querySelectorAll('.tool').forEach(tool => {
      tool.addEventListener('click', (e) => selectTool(e.currentTarget.dataset.tool, true));
    });
    window.markerToolbarState.toolbar.querySelectorAll('.action').forEach(action => {
      action.addEventListener('click', (e) => performAction(e.currentTarget.dataset.action));
    });
  }
}

function initCanvas() {
  if (!window.markerToolbarState.canvas) {
    window.markerToolbarState.canvas = document.createElement('canvas');
    window.markerToolbarState.canvas.id = 'marker-canvas';

    window.markerToolbarState.ctx = window.markerToolbarState.canvas.getContext('2d');

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('dblclick', handleDblClick);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', debounce(resizeCanvas, 250));
    window.addEventListener('scroll', updateCanvasPosition);

    document.body.appendChild(window.markerToolbarState.canvas);

    resizeCanvas();
  }
}

function initGrid() {
  if (!window.markerToolbarState.grid) {
    const grid = document.createElement('div');
    grid.id = "marker-grid";

    window.markerToolbarState.grid = grid;

    document.body.appendChild(grid);
  }
}

function toggleGrid() {
  window.markerToolbarState.grid.style.display = window.markerToolbarState.grid.style.display === "block" ? "none" : "block";
}

function resizeCanvas() {
  if (window.markerToolbarState.canvas) {
    window.markerToolbarState.canvas.width = window.innerWidth;
    window.markerToolbarState.canvas.height = window.innerHeight;
    redrawCanvas();
  }
}

function updateCanvasPosition() {
  requestAnimationFrame(redrawCanvas);
}

function renderLoop() {
  if (window.markerToolbarState.redraw) {
    _redrawCanvas();
    window.markerToolbarState.redraw = false;
  }
  requestAnimationFrame(renderLoop);
}

function redrawCanvas() {
  window.markerToolbarState.redraw = true;
}

function _redrawCanvas() {
  if (!window.markerToolbarState.ctx || !window.markerToolbarState.canvas) return;
  const tool = window.markerToolbarState.currentTool;

  window.markerToolbarState.canvas.style.pointerEvents = tool === 'cursor' ? 'none' : 'auto';

  window.markerToolbarState.ctx.clearRect(0, 0, window.markerToolbarState.canvas.width, window.markerToolbarState.canvas.height);

  let renderedElements = getElements();
  const currentElement = window.markerToolbarState.currentElement;
  let edited = null;

  if (currentElement != null) {
    edited = currentElement.edits && currentElement.edits.idx;
    renderedElements.push(currentElement);
  }

  for (const [index, item] of renderedElements.entries()) {
    if (index === edited) continue;

    if (item.type === 'drawing') {
      drawDrawing(item.data, item.finished);
    } else if (item.type === 'clipping') {
      drawClipping(item.data, item.finished);
    } else if (item.type === 'text') {
      if (item.data.tool === "mathjax" && item.finished) {
        drawImage(item.data);
      } else {
        drawText(item.data, item.finished);
      }
    }
  }
}

function drawDrawing(drawing, finished = false) {
  const drawingSize = finished ? drawing.size : window.markerToolbarState.tools[drawing.tool].size
  const drawingColor = finished ? drawing.color : window.markerToolbarState.tools[drawing.tool].color

  window.markerToolbarState.ctx.globalAlpha = 1.0;
  window.markerToolbarState.ctx.globalCompositeOperation = 'source-over';
  window.markerToolbarState.ctx.lineWidth = drawingSize;
  window.markerToolbarState.ctx.lineCap = 'round';
  window.markerToolbarState.ctx.strokeStyle = drawingColor;

  switch (drawing.tool) {
    case 'pen':
      window.markerToolbarState.ctx.globalCompositeOperation = 'source-over';
      break;
    case 'highlighter':
      window.markerToolbarState.ctx.globalAlpha = window.markerToolbarState.tools.highlighter.transparency;
      window.markerToolbarState.ctx.globalCompositeOperation = 'multiply';
      break;
    case 'eraser':
      window.markerToolbarState.ctx.globalCompositeOperation = 'destination-out';
      break;
  }

  window.markerToolbarState.ctx.beginPath();
  const firstPoint = drawing.points[0];
  window.markerToolbarState.ctx.moveTo(firstPoint.x - window.scrollX + drawing.offset.x, firstPoint.y - window.scrollY + drawing.offset.y);
  for (let i = 1; i < drawing.points.length; i++) {
    const point = drawing.points[i];
    window.markerToolbarState.ctx.lineTo(point.x - window.scrollX + drawing.offset.x, point.y - window.scrollY + drawing.offset.y);
  }
  window.markerToolbarState.ctx.stroke();
}

function drawClipping(drawing, finished = false) {
  const drawingSize = 2;
  const drawingColor = "red";

  window.markerToolbarState.ctx.globalAlpha = 1.0;
  window.markerToolbarState.ctx.globalCompositeOperation = 'source-over';
  window.markerToolbarState.ctx.lineWidth = drawingSize;
  window.markerToolbarState.ctx.lineCap = 'round';
  window.markerToolbarState.ctx.strokeStyle = drawingColor;

  const p0 = drawing.points[0];
  const p1 = drawing.points[1];
  const points = [p0, {x: p0.x, y: p1.y}, p1, {x: p1.x, y: p0.y}, p0]

  window.markerToolbarState.ctx.beginPath();
  window.markerToolbarState.ctx.moveTo(p0.x - window.scrollX + drawing.offset.x, p0.y - window.scrollY + drawing.offset.y);
  points.forEach(point => {
    window.markerToolbarState.ctx.lineTo(point.x - window.scrollX + drawing.offset.x, point.y - window.scrollY + drawing.offset.y);
  });
  window.markerToolbarState.ctx.stroke();
}

// https://stackoverflow.com/a/41491220
function colorIsDark(bgColor) {
  let color = (bgColor.charAt(0) === '#') ? bgColor.substring(1, 7) : bgColor;
  let r = parseInt(color.substring(0, 2), 16); // hexToR
  let g = parseInt(color.substring(2, 4), 16); // hexToG
  let b = parseInt(color.substring(4, 6), 16); // hexToB
  let uicolors = [r / 255, g / 255, b / 255];
  let c = uicolors.map((col) => {
    if (col <= 0.03928) {
      return col / 12.92;
    }
    return Math.pow((col + 0.055) / 1.055, 2.4);
  });
  let L = (0.2126 * c[0]) + (0.7152 * c[1]) + (0.0722 * c[2]);
  return L <= 0.179;
}

function drawText(textInput, finished = false) {
  // TODO: This is not doing anything because all drawings are still finished on mouseup
  const color = finished ? textInput.color : window.markerToolbarState.tools[textInput.tool].color;
  const size = finished ? textInput.size : window.markerToolbarState.tools[textInput.tool].size;

  window.markerToolbarState.ctx.globalAlpha = 1.0;
  window.markerToolbarState.ctx.globalCompositeOperation = 'source-over';

  window.markerToolbarState.ctx.font = `${size}px Arial`;
  window.markerToolbarState.ctx.fillStyle = color;

  let x = textInput.origin.x - window.scrollX + textInput.offset.x
  let y = textInput.origin.y - window.scrollY + textInput.offset.y

  const text = textInput.preview_text || textInput.text;
  const textLines = text.split(/(?<=\n)/);

  if (finished) {
    for (let i = 0; i < textLines.length; i++) {
      window.markerToolbarState.ctx.fillText(textLines[i], x, y + size * i);
    }
  } else {
    if (text.endsWith('\n')) {
      textLines.push('');
    }

    if (textInput.selectionStart === textInput.selectionEnd) {
      let currentLength = 0;
      let cursorCharIndex = 0;
      let cursorLineIndex = 0;

      for (let i = 0; i < textLines.length; i++) {
        cursorLineIndex = i;
        cursorCharIndex = textLines[i].length;

        if (textInput.selectionStart < (currentLength + textLines[i].length)) {
          cursorCharIndex = textInput.selectionStart - currentLength;
          break;
        }

        currentLength += textLines[i].length;
      }

      const cursorOffsetX = 1;
      const cursorOffsetY = 2;
      const textWidth = window.markerToolbarState.ctx.measureText(textLines[cursorLineIndex].substring(0, cursorCharIndex)).width;

      for (let i = 0; i < textLines.length; i++) {
        window.markerToolbarState.ctx.fillText(textLines[i], x, y + size * i);
      }

      window.markerToolbarState.ctx.beginPath();
      window.markerToolbarState.ctx.moveTo(x + textWidth + cursorOffsetX, y + (cursorLineIndex - 1) * size + cursorOffsetY);
      window.markerToolbarState.ctx.lineTo(x + textWidth + cursorOffsetX, y + (cursorLineIndex + 0.2) * size + cursorOffsetY);
      window.markerToolbarState.ctx.strokeStyle = color;
      window.markerToolbarState.ctx.lineWidth = 2;
      window.markerToolbarState.ctx.stroke();
    } else {
      let currentLength = 0;

      for (let i = 0; i < textLines.length; i++) {
        const line_y = y + textInput.size * i;
        const line_length = textLines[i].length;

        const selectionStart = Math.max(Math.min(textInput.selectionStart - currentLength, line_length), 0);
        const selectionEnd = Math.max(Math.min(textInput.selectionEnd - currentLength, line_length), 0);

        const textWidth1 = window.markerToolbarState.ctx.measureText(textLines[i].substring(0, selectionStart)).width;
        const textWidth2 = window.markerToolbarState.ctx.measureText(textLines[i].substring(selectionStart, selectionEnd)).width;

        window.markerToolbarState.ctx.fillStyle = color;
        window.markerToolbarState.ctx.fillText(textLines[i].substring(0, selectionStart), x, line_y);

        window.markerToolbarState.ctx.beginPath();
        window.markerToolbarState.ctx.rect(x + textWidth1, line_y - size, textWidth2, size * 1.2);
        window.markerToolbarState.ctx.fill();

        window.markerToolbarState.ctx.fillStyle = colorIsDark(color) ? "#FFFFFF" : "#000000";
        window.markerToolbarState.ctx.fillText(textLines[i].substring(selectionStart, selectionEnd), x + textWidth1, line_y);

        window.markerToolbarState.ctx.fillStyle = color;
        window.markerToolbarState.ctx.fillText(textLines[i].substring(selectionEnd), x + textWidth1 + textWidth2, line_y);

        currentLength += line_length;
      }
    }
  }
}

function drawImage(textInput) {
  window.markerToolbarState.ctx.globalAlpha = 1.0;
  window.markerToolbarState.ctx.globalCompositeOperation = 'source-over';

  const image = window.markerToolbarState.images[textInput.text]

  if (image)
    window.markerToolbarState.ctx.drawImage(image, textInput.x - window.scrollX + textInput.offset.x, textInput.y - window.scrollY + textInput.offset.y, textInput.width, textInput.height)
}

function updateColor(e) {
  const currentTool = window.markerToolbarState.currentTool;
  if (['pen', 'highlighter', 'text', 'mathjax', 'line'].includes(currentTool)) {
    window.markerToolbarState.tools[currentTool].color = e.target.value;
  }
  const textarea = window.markerToolbarState.textarea;
  if (textarea) {
    setTimeout(function() {
      textarea.focus();
    }, 0);
  }
  redrawCanvas();
}

function updateSize(e) {
  const currentTool = window.markerToolbarState.currentTool;
  if (['pen', 'highlighter', 'text', 'mathjax', 'line', 'eraser'].includes(currentTool)) {
    window.markerToolbarState.tools[currentTool].size = parseInt(e.target.value);
  }
  const textarea = window.markerToolbarState.textarea;
  if (textarea) {
    setTimeout(function() {
      textarea.focus();
    }, 0);
  }
  redrawCanvas();
}

function redrawToolbar() {
  const tool = window.markerToolbarState.currentTool;
  const toolSettings = window.markerToolbarState.tools[tool];

  document.body.style.cursor = tool === 'cursor' ? 'default' : 'crosshair';

  const colorInput = document.getElementById('color');
  const sizeInput = document.getElementById('size');

  if (toolSettings.hasOwnProperty('color') && colorInput) {
    colorInput.value = toolSettings.color;
  }
  if (toolSettings.hasOwnProperty('size') && sizeInput) {
    sizeInput.value = toolSettings.size;
  }

  const buttons = document.querySelectorAll('.tool');
  buttons.forEach(button => {
    button.classList.remove('active');
  });

  const activeButton = document.querySelector(`.tool[data-tool="${tool}"]`);
  if (activeButton) {
    activeButton.classList.add('active');
  }

  const undoButton = document.querySelector('.action[data-action="undo"]');
  const redoButton = document.querySelector('.action[data-action="redo"]');

  // Disable undo button if undoStack is empty
  if (undoButton) {
    undoButton.disabled = window.markerToolbarState.undoStack.length === 0;
  }

  // Disable redo button if redoStack is empty
  if (redoButton) {
    redoButton.disabled = window.markerToolbarState.redoStack.length === 0;
  }
}

function performAction(action) {
  switch (action) {
    case 'undo':
      undo();
      break;
    case 'redo':
      redo();
      break;
    case 'delete':
      clearCanvas();
      break;
    case 'exit':
      toggleExtension();
      break;
  }
}

function startTextInput(point, toolSettings, tool) {
  let newTextInput = {
    type: 'text',
    finished: false,
    data: {
      tool: tool,
      x: null,
      y: null,
      width: null,
      height: null,
      offset: {
        x: null,
        y: null,
      },
      origin: {
        x: point.x,
        y: point.y,
      },
      color: toolSettings.color,
      size: toolSettings.size,
      text: '',
      selectionStart: 0,
    }
  }

  window.markerToolbarState.currentElement = newTextInput;
  attachTextInput(newTextInput);

  redrawCanvas();
}

function editElement(elementId) {
  let newElements = getElements();

  let newElement = newElements[elementId];
  newElement.finished = false;
  newElement.edits = {
    idx: elementId,
    type: "text",
  }

  window.markerToolbarState.currentElement = newElement;

  if (newElement.type === "text") {
    attachTextInput(newElement)
  };

  redrawCanvas();
}

function attachTextInput(textInput){
  const textarea = document.createElement('textarea');
  const toolbar = document.getElementById('marker-toolbar');

  textarea.style.cssText = `
    position: absolute;
    top: 9999px;
    left: 9999px;
  `;

  textarea.addEventListener('input', function (e) {
    const currentTextInput = window.markerToolbarState.currentElement;

    if (currentTextInput && ["text", "mathjax"].includes(currentTextInput.type)) {
      currentTextInput.data.selectionStart = e.target.selectionStart;
      currentTextInput.data.selectionEnd = e.target.selectionEnd;

      currentTextInput.data.preview_text = null;
      currentTextInput.data.preview_index = null;
      currentTextInput.data.text = e.target.value;

      redrawCanvas();
    }
  });

  textarea.addEventListener('selectionchange', function (e) {
    const currentTextInput = window.markerToolbarState.currentElement;

    if (currentTextInput && ["text", "mathjax"].includes(currentTextInput.type)) {
      currentTextInput.data.selectionStart = e.target.selectionStart;
      currentTextInput.data.selectionEnd = e.target.selectionEnd;
      redrawCanvas();
    }
  });

  textarea.addEventListener('keydown', function (e) {
    e.stopPropagation();

    // I wish there was a way to evaluate shortcuts here without the ambiguity problem.
    // For example, when a user presses Control + Z to undo, do they want to undo the text input or the extension's last action?
    // Perhaps we could categorize some shortcuts as safe and others as unsafe, but there's no guarantee that they'll always be safe.
    // Anyway, enable this line if you want to allow tool switching without having to press Escape to finish text input.
    // handleKeyDown(e);

    if (e.code === "Escape") {
      finishCurrentElement();
    } else if (!e.shiftKey && e.code === "Enter") {
      e.preventDefault(); // Prevents a new linefrom being appended
      finishCurrentElement();
    } else if (e.code === "ArrowUp" || e.code === "ArrowDown") {
      const elements = getElements();
      const currentTextInput = window.markerToolbarState.currentElement;

      if (currentTextInput && ["text", "mathjax"].includes(currentTextInput.type) && currentTextInput.data.text.trim() === '') {
        const textItems = elements.filter(item => item.type === 'text');

        if(currentTextInput.data.preview_index == null) {
          currentTextInput.data.preview_index = textItems.length;
        }

        currentTextInput.data.preview_index += e.code === "ArrowUp" ? -1 : 1;

        currentTextInput.data.preview_index = Math.max(0, Math.min(currentTextInput.data.preview_index, textItems.length));

        if (currentTextInput.data.preview_index < textItems.length) {
          currentTextInput.data.preview_text = textItems[currentTextInput.data.preview_index].data.text;
        } else {
          currentTextInput.data.preview_text = null;
        }

        setTimeout(function() {
          textarea.value = textInput.data.preview_text || textInput.data.text;
          textarea.focus();
        }, 0);

        redrawCanvas();
      }
    } else if (e.ctrlKey && e.shiftKey && e.code === "Equal") { // Ctrl + "+" key combination
      e.preventDefault();
      const currentTool = window.markerToolbarState.currentTool;
      const toolSettings = window.markerToolbarState.tools[currentTool];
      if (['text', 'mathjax'].includes(currentTool)) {
        const currentTextInput = window.markerToolbarState.currentElement;
        if (currentTextInput) {
          toolSettings.size = Math.min(toolSettings.size + 1, 50); // Limit max size

          redrawToolbar();
          redrawCanvas();
        }
      }
    } else if (e.ctrlKey && e.code === "Minus") { // Ctrl + "-" key combination
      e.preventDefault();
      const currentTool = window.markerToolbarState.currentTool;
      const toolSettings = window.markerToolbarState.tools[currentTool];
      if (['text', 'mathjax'].includes(currentTool)) {
        const currentTextInput = window.markerToolbarState.currentElement;
        if (currentTextInput) {
          toolSettings.size = Math.max(toolSettings.size - 1, 1); // Limit min size

          redrawToolbar();
          redrawCanvas();
        }
      }
    }
  });
  textarea.addEventListener('keyup', function (e) {
    e.stopPropagation();
  });

  toolbar.appendChild(textarea);

  window.markerToolbarState.textarea = textarea;

  setTimeout(function() {
    textarea.value = textInput.data.preview_text || textInput.data.text;
    textarea.focus();
  }, 0);
}

function detachTextInput() {
  const textarea = window.markerToolbarState.textarea;

  if (textarea)
    textarea.remove();

  document.body.focus();
}

async function finishCurrentElement() {
  let currentElement = window.markerToolbarState.currentElement;

  if (currentElement) {
    if (currentElement.edits != null) {
      if (currentElement.edits.type === "move") {
        finishMoving();
      }
    } else if (currentElement.type === "text") {
      await finishTextInput();
    } else if (currentElement.type === "drawing"){
      finishDrawing();
    } else if (currentElement.type === "clipping"){
      finishClipping();
    } else {
      clearCurrentElement();
    }
  }
}

function clearCurrentElement() {
  window.markerToolbarState.currentElement = null;

  redrawCanvas();
  redrawToolbar();
}

async function finishTextInput() {
  let currentTextInput = window.markerToolbarState.currentElement;

  if (currentTextInput && currentTextInput.type === "text") {
    currentTextInput = JSON.parse(JSON.stringify(currentTextInput));

    if (currentTextInput.data.preview_text != null) {
      currentTextInput.data.text = currentTextInput.data.preview_text;
      currentTextInput.data.preview_index = null;
      currentTextInput.data.preview_text = null;
    }

    if (currentTextInput.data.text.trim() !== '') {
      currentTextInput.data.size = window.markerToolbarState.tools[currentTextInput.data.tool].size;
      currentTextInput.data.color = window.markerToolbarState.tools[currentTextInput.data.tool].color;
      await renderTextInput(currentTextInput);

      currentTextInput.finished = true;

      let newElements = getElements();

      if (currentTextInput.edits != null)
        newElements.splice(currentTextInput.edits.idx, 1)[0]

      newElements.push(currentTextInput);

      window.markerToolbarState.undoStack.push(newElements);
      window.markerToolbarState.redoStack = [];
    }
  }

  detachTextInput();

  clearCurrentElement();
}

function renderTextInput(textInput) {
  return new Promise((resolve, reject) => {
    if (textInput.data.tool === 'mathjax') {
      if (!textInput.finished) {
        let { size, text, color } = textInput.data;

        let svg = MathJax.tex2svg(`\\color{${color}} \\displaylines {${text.replace(/\n/g, "\\\\")}}`, { em: 12, ex: 6 }).firstElementChild;

        let img = document.createElement('img');
        img.onload = (e) => {
          let tempWidth = e.target.naturalWidth * size / 16;
          let tempHeight = e.target.naturalHeight * size / 16;

          textInput.data.x = textInput.data.origin.x;
          textInput.data.y = textInput.data.origin.y - size;
          textInput.data.width = tempWidth;
          textInput.data.height = tempHeight;

          resolve("rendered");
        }

        img.src = 'data:image/svg+xml;base64,' + btoa('<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n' + svg.outerHTML);

        window.markerToolbarState.images[text] = img;
      } else {
        resolve("rendered");
      }
    } else {
      const lines = textInput.data.text.split("\n");

      textInput.data.x = textInput.data.origin.x;
      textInput.data.y = textInput.data.origin.y - textInput.data.size;
      textInput.data.height = lines.length * textInput.data.size;
      textInput.data.width = Math.max(...lines.map(line => line.length * textInput.data.size / 2)) // this is not robust at all

      resolve("rendered");
    }
  });
}

function startClipping(point) {
  const toolSettings = window.markerToolbarState.tools[window.markerToolbarState.currentTool];

  const newClipping = { 
    type: 'clipping',
    finished: false,
    data: {
      x: null,
      y: null,
      offset: {
        x: null,
        y: null,
      },
      width: null,
      height: null,
      tool: window.markerToolbarState.currentTool,
      points: [point, point]
    }
  };

  newClipping.beforeFinish = async function () {
    this.data.x = Math.min(this.data.points[1].x, this.data.points[0].x)
    this.data.y = Math.min(this.data.points[1].y, this.data.points[0].y)
    this.data.width = Math.abs(this.data.points[1].x - this.data.points[0].x)
    this.data.height = Math.abs(this.data.points[1].y - this.data.points[0].y)
  }

  newClipping.afterFinish = async function () {
    const x = this.data.x - window.scrollX;
    const y = this.data.y - window.scrollY;
    const w = this.data.width;
    const h = this.data.height;

    browser
      .runtime
      .sendMessage({ action: 'screenshot' })
      .then((image_url) => {
        if (image_url && image_url.startsWith('data:image/png')) {
          const img = new Image();
          img.onload = () => {
            const newCanvas = document.createElement('canvas');
            const newCtx = newCanvas.getContext('2d');
            newCanvas.width = w;
            newCanvas.height = h;
            newCtx.drawImage(img, x, y, w, h, 0, 0, w, h);

            const dataUrl = newCanvas.toDataURL('image/png');
            showNotification("clipped", dataUrl)

            fetch(CLIP_TOOL_ENDPOINT, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'bypass-tunnel-reminder': 'yes',
              },
              body: JSON.stringify({ image: dataUrl }),
            })
            .then(async (data) => {
              const json = await data.json();

              if (data.status === 200) {
                navigator.clipboard.writeText(json).then(() => {
                  showNotification('Copied to clipboard: ' + json);
                }).catch(err => {
                  showNotification('Failed to copy to clipboard: ' + err);
                });
              } else {
                console.error(`Status: ${data.status} - ${data.statusText}`);
                console.error(`Response: ${json}`);
              }
            })
            .catch((error) => {
              console.error('Error:', error);
            });
          };
          img.src = image_url;
        } else {
          console.error("Invalid image source provided.");
        }
      });
  }

  window.markerToolbarState.currentElement = newClipping;

  redrawCanvas();
}

function startDrawing(point) {
  const toolSettings = window.markerToolbarState.tools[window.markerToolbarState.currentTool];

  const newDrawing = { 
    type: 'drawing',
    finished: false,
    data: {
      x: null,
      y: null,
      offset: {
        x: null,
        y: null,
      },
      width: null,
      height: null,
      tool: window.markerToolbarState.currentTool, 
      color: toolSettings.color || '#000000', 
      size: toolSettings.size || 1, 
      points: [point, point]
    }
  };

  window.markerToolbarState.currentElement = newDrawing;

  redrawCanvas();
}

function draw(point) {
  const currentDrawing = window.markerToolbarState.currentElement;

  if (currentDrawing) {
    if (['line', 'clip'].includes(currentDrawing.data.tool)) {
      currentDrawing.data.points[1] = point
    } else {
      currentDrawing.data.points.push(point);
    }

    redrawCanvas();
  }
}

function finishDrawing() {
  const currentDrawing = window.markerToolbarState.currentElement;

  if (currentDrawing.data.tool === 'line') {
    currentDrawing.data.x = Math.min(currentDrawing.data.points[1].x, currentDrawing.data.points[0].x)
    currentDrawing.data.y = Math.min(currentDrawing.data.points[1].y, currentDrawing.data.points[0].y)
    currentDrawing.data.width = Math.abs(currentDrawing.data.points[1].x - currentDrawing.data.points[0].x)
    currentDrawing.data.height = Math.abs(currentDrawing.data.points[1].y - currentDrawing.data.points[0].y)
  } else if (['pen', 'highlighter'].includes(currentDrawing.data.tool)) {
    const xs = currentDrawing.data.points.map(p => p.x)
    const ys = currentDrawing.data.points.map(p => p.y)

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    currentDrawing.data.x = minX;
    currentDrawing.data.y = minY;
    currentDrawing.data.width = maxX - minX;
    currentDrawing.data.height = maxY - minY;
  }

  currentDrawing.finished = true;

  let newElements = getElements();
  newElements.push(currentDrawing);

  window.markerToolbarState.undoStack.push(newElements);
  window.markerToolbarState.redoStack = [];

  clearCurrentElement();
}

function finishClipping() {
  const currentDrawing = window.markerToolbarState.currentElement;

  if (currentDrawing.beforeFinish != null) {
    currentDrawing.beforeFinish();
  }

  currentDrawing.finished = true;

  if (currentDrawing.afterFinish != null) {
    currentDrawing.afterFinish();
  }

  clearCurrentElement();
}

function startMoving(index, x, y) {
  let newElements = getElements();

  let newElement = newElements[index];
  // newElement.finished = false;
  newElement.edits = {
    type: "move",
    idx: index,
  };

  window.markerToolbarState.currentElement = newElement;

  window.markerToolbarState.tools.move.anchor = {
    x: x - newElement.data.offset.x,
    y: y - newElement.data.offset.y
  };

  redrawCanvas();
}

function move(point) {
  const movedElement = window.markerToolbarState.currentElement;
  const { x: anchorX, y: anchorY } = window.markerToolbarState.tools.move.anchor

  movedElement.data.offset.x = point.x - anchorX;
  movedElement.data.offset.y = point.y - anchorY;

  redrawCanvas();
}

function finishMoving() {
  const currentElement = window.markerToolbarState.currentElement;
  currentElement.finished = true;

  let newElements = getElements();

  newElements.splice(currentElement.edits.idx, 1)[0]

  newElements.push(currentElement);

  window.markerToolbarState.undoStack.push(newElements);
  window.markerToolbarState.redoStack = [];

  clearCurrentElement();
}

function handleMouseDown(e) {
  if (!window.markerToolbarState.enabled || window.markerToolbarState.currentTool === 'cursor' || e.target.closest('#marker-toolbar')) return;

  const point = getAdjustedPoint(e);
  const currentTool = window.markerToolbarState.currentTool;
  const toolSettings = window.markerToolbarState.tools[currentTool];

  if (["text", "mathjax"].includes(currentTool)) {
    finishTextInput().then(() => {
      startTextInput(point, toolSettings, currentTool);
    });
  } else if (['pen', 'eraser', 'line', 'highlighter'].includes(currentTool)) {
    startDrawing(point);
  } else if (currentTool === 'clip') {
    startClipping(point);
  } else if (currentTool === 'move') {
    const elements = getElements();

    const intersectingId = pointIntersection(point, elements);

    if (intersectingId > -1) {
      startMoving(intersectingId, point.x, point.y);
    }
  }
}

function handleMouseMove(e) {
  const currentTool = window.markerToolbarState.currentTool;
  const currentElement = window.markerToolbarState.currentElement;

  if (!window.markerToolbarState.enabled || currentTool === 'cursor' || e.target.closest('#marker-toolbar')) return;

  const point = getAdjustedPoint(e);

  if (currentElement) {
    if (currentElement.edits != null) {
      if (currentElement.edits.type === "move") {
        move(point);
      }
    } else if (["drawing", "clipping"].includes(currentElement.type)) {
      draw(point)
    }
  }
}

function handleMouseUp(e) {
  const currentElement = window.markerToolbarState.currentElement;
  const currentTool = window.markerToolbarState.currentTool;

  if (!window.markerToolbarState.enabled || currentTool === 'cursor') return;

  if (currentElement) {
    if (currentElement.edits != null) {
      if (currentElement.edits.type === "move") {
        finishMoving();
      }
    } else if (["drawing"].includes(currentElement.type)) {
      finishDrawing();
    } else if (["clipping"].includes(currentElement.type)) {
      finishClipping();
    }
  }
}

function handleDblClick(e) {
  const currentTool = window.markerToolbarState.currentTool;
  const currentElement = window.markerToolbarState.currentElement;

  if (!window.markerToolbarState.enabled || currentTool === 'cursor' || e.target.closest('#marker-toolbar')) return;

  const point = getAdjustedPoint(e);

  if (["text", "mathjax"].includes(currentTool)) {
    const elements = getElements()

    const intersectingId = pointIntersection(point, elements);

    if (intersectingId > -1 && elements[intersectingId].type === "text") {
      finishCurrentElement().then(() => {
        editElement(intersectingId);
      })
    }
  }
}

function pointIntersection(point, elements) {
  let intersectingId = -1;

  for (let i = elements.length - 1; i >= 0; i--) {
    const obj = elements[i];

    if (
      point.x >= obj.data.x + obj.data.offset?.x &&
      point.x <= obj.data.x + obj.data.width + obj.data.offset?.x &&
      point.y >= obj.data.y + obj.data.offset?.y &&
      point.y <= obj.data.y + obj.data.height + obj.data.offset?.y
    ) {
      intersectingId = i;
      break;
    }
  }

  return intersectingId;
}

const keyShortcuts = [
  { keys: ['KeyS'], modifiers: ['Alt', 'Shift'], tool: 'smiley' },

  { keys: ['KeyC'], modifiers: ['Alt'],               tool: 'cursor',       clicked: true },
  { keys: ['KeyT'], modifiers: ['Alt'],               tool: 'text',         clicked: true },
  { keys: ['KeyF'], modifiers: ['Alt'],               tool: 'mathjax',      clicked: true },
  { keys: ['KeyL'], modifiers: ['Alt'],               tool: 'line',         clicked: true },
  { keys: ['KeyD'], modifiers: ['Alt'],               tool: 'pen',          clicked: true },
  { keys: ['KeyE'], modifiers: ['Alt'],               tool: 'eraser',       clicked: true },
  { keys: ['KeyM'], modifiers: ['Alt'],               tool: 'move',         clicked: true },
  { keys: ['KeyH'], modifiers: ['Alt'],               tool: 'highlighter',  clicked: true },
  { keys: ['KeyG'], modifiers: ['Alt'],               tool: 'grid',         clicked: true },
  { keys: ['KeyZ'], modifiers: ['Control', 'Shift'],  tool: 'redo',         clicked: true },
  { keys: ['KeyZ'], modifiers: ['Control'],           tool: 'undo',         clicked: true },
  { keys: ['KeyY'], modifiers: ['Control'],           tool: 'redo',         clicked: true },
  { keys: ['KeyW'], modifiers: ['Alt'],               tool: 'clear',        clicked: true },
  { keys: ['KeyQ'], modifiers: ['Alt'],               tool: 'quit',         clicked: true },


  { keys: ['Escape'],       tool: 'console' },
  { keys: ['ControlLeft'],  tool: 'cursor' },
  { keys: ['ControlRight'], tool: 'cursor' },
  { keys: ['ShiftLeft'],    tool: 'move' },
  { keys: ['ShiftRight'],   tool: 'move' }
];

function hasRequiredModifiers(shortcutModifiers, event) {
  return shortcutModifiers ? shortcutModifiers.every(mod => {
    switch (mod) {
      case 'Control':
        return event.ctrlKey;
      case 'Alt':
        return event.altKey;
      case 'Meta':
        return event.metaKey; // for MacOS
      case 'Shift':
        return event.shiftKey;
      default:
        return false;
    }
  }) : true;
}

function handleKeyDown(e) {
  // Check if the extension is disabled
  const currentTime = Date.now();
  const disabledTime = currentTime - window.markerToolbarState.disabledAt;

  if (!window.markerToolbarState.enabled && disabledTime > 1000) return;

  // [2024-10-14] I disabled these (a, b & c) because of the change of most shortcuts from a single key to
  // Alt + key. Before this change, if a user was in cursor mode and started typing something in a
  // textbox, for example, then the marker toolbar would change tool if a shortcut key was pressed.
  // now that Alt + key is used the ambiguity is removed. I still really liked the usability of single
  // key tool switching but it just makes the whole keyboard event handling more complex for little gain.
  // If a power user needs to use single key shortcuts maybe add that as an advanced option (?).
  //
  // (a) This disabled means that shortcuts will be evaluated even if the toolbar is in clicked cursor mode.
  // if (isCurrentClicked("cursor")) return;
  // (b) This disabled makes Ctrl+Shift+i and other chrome commands work as usual.
  // e.preventDefault();
  // (c) This disabled is just logical, do not remember why I added it.
  // e.stopPropagation();

  // Loop through the defined shortcuts to find a match
  for (const shortcut of keyShortcuts) {
    const isMatch = shortcut.keys.includes(e.code);
    const hasModifiers = hasRequiredModifiers(shortcut.modifiers, e);

    if (isMatch && hasModifiers) {
      e.preventDefault();

      executeShortcut(shortcut.tool, !!shortcut.clicked);
      return; // Exit after executing the first matching shortcut
    }
  }

  // Additional logic for unhandled keys or specific actions can be added here
}

function executeShortcut(tool, clicked) {
  switch (tool) {
    case 'quit':
      toggleExtension();
      break;
    case 'clear':
      clearCanvas();
      break;
    case 'grid':
      toggleGrid();
      break;
    case 'undo':
      undo();
      break;
    case 'redo':
      redo();
      break;
    case 'smiley':
      const smiley = `
        \\begin{pmatrix}
        \\frown & & \\frown \\\\
          & \\smile &
        \\end{pmatrix}
      `
      navigator.clipboard.writeText(smiley);
      break;
    case 'console':
      console.log("Marker Toolbar State: ", window.markerToolbarState);
      break;
    default:
      if (window.markerToolbarState.currentTool !== tool) {
        if (!clicked) {
          const lastTool = window.markerToolbarState.currentTool;
          document.addEventListener("keyup", function () {
            selectTool(lastTool, true);
          }, { once: true })
        };
        // [2024-10-14] Part of the key to Alt + key change. Now
        selectTool(tool, clicked);
      }
      break;
  }

}

// function isCurrentClicked(tool) {
//   if (tool != null) {
//     return window.markerToolbarState.currentToolClicked === true;
//   }
//
//   return window.markerToolbarState.currentTool === tool && window.markerToolbarState.currentToolClicked === true
// }

async function selectTool(tool, clicked = false) {
  await finishCurrentElement();

  if (tool == null) {
    tool = "pen"
  }

  await storage.setItem('local:tool', tool);
  window.markerToolbarState.currentTool = tool;
  window.markerToolbarState.currentToolClicked = clicked;

  redrawToolbar();
  redrawCanvas();
}

async function restoreTool() {
  const tool = await storage.getItem('local:tool');

  selectTool(tool, true);
}

function getAdjustedPoint(e) {
  return {
    x: e.clientX + window.scrollX,
    y: e.clientY + window.scrollY
  };
}

async function undo() {
  // We run this so that if the current text input is empty, it will handle
  // (destroy) itself, and if it is not empty, the text will return to be
  // empty.
  //
  // This feels more natural but its not definitive.

  await finishCurrentElement();

  if (window.markerToolbarState.undoStack.length > 0) {
    const removedItem = window.markerToolbarState.undoStack.pop();
    window.markerToolbarState.redoStack.push(removedItem);
    redrawCanvas();
    redrawToolbar();
  }
}

function redo() {
  clearCurrentElement();

  if (window.markerToolbarState.redoStack.length > 0) {
    const redoItem = window.markerToolbarState.redoStack.pop();
    window.markerToolbarState.undoStack.push(redoItem);
    redrawCanvas();
    redrawToolbar();
  }
}

function clearCanvas() {
  window.markerToolbarState.undoStack = [];
  window.markerToolbarState.redoStack = [];
  window.markerToolbarState.currentElement = null;
  window.markerToolbarState.images = {};
  redrawCanvas();
  redrawToolbar();
}

function showNotification(message, imageUrl) {
  const notification = document.createElement('div');
  notification.style.position = 'fixed';
  notification.style.bottom = '20px';
  notification.style.left = '20px';
  notification.style.backgroundColor = '#333';
  notification.style.color = '#fff';
  notification.style.padding = '10px';
  notification.style.borderRadius = '5px';
  notification.style.zIndex = '9999';
  notification.style.margin = '0';

  if (imageUrl) {
    const img = document.createElement('img');
    img.src = imageUrl;
    img.style.maxHeight = '100px';
    img.style.marginRight = '10px';
    notification.appendChild(img);
  }

  const textNode = document.createTextNode(message);
  notification.appendChild(textNode);

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 10000);
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function injectAndRunMarkerToolbar() {
  if (window.markerToolbarState) {
    toggleExtension();
    return;
  }

  window.markerToolbarState = {
    enabled: false,
    currentTool: 'pen',
    currentToolClicked: false,
    currentElement: null,
    tools: {
      pen: { size: 5, color: '#FF0000' },
      highlighter: { size: 10, color: '#FFFF00', transparency: 0.3 },
      eraser: { size: 20 },
      cursor: {},
      mathjax: { size: 32, color: '#000000' },
      text: { size: 32, color: '#000000' },
      move: { anchor: {} },
      line: { size: 2, color: '#FF0000' },
      clip: {},
    },
    toolbar: null,
    textarea: null,
    canvas: null,
    ctx: null,
    images: {},
    undoStack: [],
    redoStack: [],
  };

  initToolbar();
  initCanvas();
  initGrid();

  requestAnimationFrame(renderLoop);

  toggleExtension();

  restoreTool();
}
  },
});
