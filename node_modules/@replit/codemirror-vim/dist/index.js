import { initVim } from '@replit/codemirror-vim-core';
import { EditorSelection, MapMode, Prec, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { foldCode, matchBrackets, indentUnit, ensureSyntaxTree, StringStream } from '@codemirror/language';
import * as View from '@codemirror/view';
import { EditorView, runScopeHandlers, Direction, ViewPlugin, Decoration, showPanel } from '@codemirror/view';
import { SearchQuery, setSearchQuery, RegExpCursor } from '@codemirror/search';
import { indentMore, indentLess, cursorLineBoundaryBackward, cursorLineBoundaryForward, cursorCharBackward, indentSelection, insertNewlineAndIndent, cursorCharLeft, toggleLineComment, undo, redo } from '@codemirror/commands';

function indexFromPos(doc, pos) {
    var ch = pos.ch;
    var lineNumber = pos.line + 1;
    if (lineNumber < 1) {
        lineNumber = 1;
        ch = 0;
    }
    if (lineNumber > doc.lines) {
        lineNumber = doc.lines;
        ch = Number.MAX_VALUE;
    }
    var line = doc.line(lineNumber);
    return Math.min(line.from + Math.max(0, ch), line.to);
}
function posFromIndex(doc, offset) {
    let line = doc.lineAt(offset);
    return { line: line.number - 1, ch: offset - line.from };
}
class Pos {
    constructor(line, ch) {
        this.line = line;
        this.ch = ch;
    }
}
function on(emitter, type, f) {
    if (emitter.addEventListener) {
        emitter.addEventListener(type, f, false);
    }
    else {
        var map = emitter._handlers || (emitter._handlers = {});
        map[type] = (map[type] || []).concat(f);
    }
}
function off(emitter, type, f) {
    if (emitter.removeEventListener) {
        emitter.removeEventListener(type, f, false);
    }
    else {
        var map = emitter._handlers, arr = map && map[type];
        if (arr) {
            var index = arr.indexOf(f);
            if (index > -1) {
                map[type] = arr.slice(0, index).concat(arr.slice(index + 1));
            }
        }
    }
}
function signal(emitter, type, ...args) {
    var _a;
    var handlers = (_a = emitter._handlers) === null || _a === void 0 ? void 0 : _a[type];
    if (!handlers)
        return;
    for (var i = 0; i < handlers.length; ++i) {
        handlers[i](...args);
    }
}
function signalTo(handlers, ...args) {
    if (!handlers)
        return;
    for (var i = 0; i < handlers.length; ++i) {
        handlers[i](...args);
    }
}
let wordChar;
try {
    wordChar = /*@__PURE__*/new RegExp("[\\w\\p{Alphabetic}\\p{Number}_]", "u");
}
catch (_) {
    wordChar = /[\w]/;
}
// workaround for missing api for merging transactions
function dispatchChange(cm, transaction) {
    var view = cm.cm6;
    if (view.state.readOnly)
        return;
    var type = "input.type.compose";
    if (cm.curOp) {
        if (!cm.curOp.lastChange)
            type = "input.type.compose.start";
    }
    if (transaction.annotations) {
        try {
            transaction.annotations.some(function (note) {
                if (note.value == "input")
                    note.value = type;
            });
        }
        catch (e) {
            console.error(e);
        }
    }
    else {
        transaction.userEvent = type;
    }
    return view.dispatch(transaction);
}
function runHistoryCommand(cm, revert) {
    var _a;
    if (cm.curOp) {
        cm.curOp.$changeStart = undefined;
    }
    (revert ? undo : redo)(cm.cm6);
    let changeStartIndex = (_a = cm.curOp) === null || _a === void 0 ? void 0 : _a.$changeStart;
    // vim mode expects the changed text to be either selected or cursor placed at the start
    if (changeStartIndex != null) {
        cm.cm6.dispatch({ selection: { anchor: changeStartIndex } });
    }
}
var keys = {
    Left: (cm) => runScopeHandlers(cm.cm6, { key: "Left" }, "editor"),
    Right: (cm) => runScopeHandlers(cm.cm6, { key: "Right" }, "editor"),
    Up: (cm) => runScopeHandlers(cm.cm6, { key: "Up" }, "editor"),
    Down: (cm) => runScopeHandlers(cm.cm6, { key: "Down" }, "editor"),
    Backspace: (cm) => runScopeHandlers(cm.cm6, { key: "Backspace" }, "editor"),
    Delete: (cm) => runScopeHandlers(cm.cm6, { key: "Delete" }, "editor"),
};
class CodeMirror {
    // --------------------------
    openDialog(template, callback, options) {
        return openDialog(this, template, callback, options);
    }
    ;
    openNotification(template, options) {
        return openNotification(this, template, options);
    }
    ;
    constructor(cm6) {
        this.state = {};
        this.marks = Object.create(null);
        this.$mid = 0; // marker id counter
        this.options = {};
        this._handlers = {};
        this.$lastChangeEndOffset = 0;
        this.virtualSelection = null;
        this.cm6 = cm6;
        this.onChange = this.onChange.bind(this);
        this.onSelectionChange = this.onSelectionChange.bind(this);
    }
    ;
    on(type, f) { on(this, type, f); }
    off(type, f) { off(this, type, f); }
    signal(type, e, handlers) { signal(this, type, e, handlers); }
    indexFromPos(pos) {
        return indexFromPos(this.cm6.state.doc, pos);
    }
    ;
    posFromIndex(offset) {
        return posFromIndex(this.cm6.state.doc, offset);
    }
    ;
    foldCode(pos) {
        let view = this.cm6;
        let ranges = view.state.selection.ranges;
        let doc = this.cm6.state.doc;
        let index = indexFromPos(doc, pos);
        let tmpRanges = EditorSelection.create([EditorSelection.range(index, index)], 0).ranges;
        view.state.selection.ranges = tmpRanges;
        foldCode(view);
        view.state.selection.ranges = ranges;
    }
    firstLine() { return 0; }
    ;
    lastLine() { return this.cm6.state.doc.lines - 1; }
    ;
    lineCount() { return this.cm6.state.doc.lines; }
    ;
    setCursor(line, ch) {
        if (typeof line === 'object') {
            ch = line.ch;
            line = line.line;
        }
        var offset = indexFromPos(this.cm6.state.doc, { line, ch: ch || 0 });
        this.cm6.dispatch({ selection: { anchor: offset } }, { scrollIntoView: !this.curOp });
        if (this.curOp && !this.curOp.isVimOp)
            this.onBeforeEndOperation();
    }
    ;
    getCursor(p) {
        var sel = this.cm6.state.selection.main;
        var offset = p == "head" || !p
            ? sel.head
            : p == "anchor"
                ? sel.anchor
                : p == "start"
                    ? sel.from
                    : p == "end"
                        ? sel.to
                        : null;
        if (offset == null)
            throw new Error("Invalid cursor type");
        return this.posFromIndex(offset);
    }
    ;
    listSelections() {
        var doc = this.cm6.state.doc;
        return this.cm6.state.selection.ranges.map(r => {
            return {
                anchor: posFromIndex(doc, r.anchor),
                head: posFromIndex(doc, r.head),
            };
        });
    }
    ;
    setSelections(p, primIndex) {
        var doc = this.cm6.state.doc;
        var ranges = p.map(x => {
            var head = indexFromPos(doc, x.head);
            var anchor = indexFromPos(doc, x.anchor);
            // workaround for codemirror bug, see https://github.com/replit/codemirror-vim/issues/169
            if (head == anchor)
                return EditorSelection.cursor(head, 1);
            return EditorSelection.range(anchor, head);
        });
        this.cm6.dispatch({
            selection: EditorSelection.create(ranges, primIndex)
        });
    }
    ;
    setSelection(anchor, head, options) {
        this.setSelections([{ anchor, head }], 0);
        if (options && options.origin == '*mouse') {
            this.onBeforeEndOperation();
        }
    }
    ;
    getLine(row) {
        var doc = this.cm6.state.doc;
        if (row < 0 || row >= doc.lines)
            return "";
        return this.cm6.state.doc.line(row + 1).text;
    }
    ;
    getLineHandle(row) {
        if (!this.$lineHandleChanges)
            this.$lineHandleChanges = [];
        return { row: row, index: this.indexFromPos(new Pos(row, 0)) };
    }
    getLineNumber(handle) {
        var updates = this.$lineHandleChanges;
        if (!updates)
            return null;
        var offset = handle.index;
        for (var i = 0; i < updates.length; i++) {
            offset = updates[i].changes.mapPos(offset, 1, MapMode.TrackAfter);
            if (offset == null)
                return null;
        }
        var pos = this.posFromIndex(offset);
        return pos.ch == 0 ? pos.line : null;
    }
    releaseLineHandles() {
        this.$lineHandleChanges = undefined;
    }
    getRange(s, e) {
        var doc = this.cm6.state.doc;
        return this.cm6.state.sliceDoc(indexFromPos(doc, s), indexFromPos(doc, e));
    }
    ;
    replaceRange(text, s, e, source) {
        if (!e)
            e = s;
        var doc = this.cm6.state.doc;
        var from = indexFromPos(doc, s);
        var to = indexFromPos(doc, e);
        dispatchChange(this, { changes: { from, to, insert: text } });
    }
    ;
    replaceSelection(text) {
        dispatchChange(this, this.cm6.state.replaceSelection(text));
    }
    ;
    replaceSelections(replacements) {
        var ranges = this.cm6.state.selection.ranges;
        var changes = ranges.map((r, i) => {
            return { from: r.from, to: r.to, insert: replacements[i] || "" };
        });
        dispatchChange(this, { changes });
    }
    ;
    getSelection() {
        return this.getSelections().join("\n");
    }
    ;
    getSelections() {
        var cm = this.cm6;
        return cm.state.selection.ranges.map(r => cm.state.sliceDoc(r.from, r.to));
    }
    ;
    somethingSelected() {
        return this.cm6.state.selection.ranges.some(r => !r.empty);
    }
    ;
    getInputField() {
        return this.cm6.contentDOM;
    }
    ;
    clipPos(p) {
        var doc = this.cm6.state.doc;
        var ch = p.ch;
        var lineNumber = p.line + 1;
        if (lineNumber < 1) {
            lineNumber = 1;
            ch = 0;
        }
        if (lineNumber > doc.lines) {
            lineNumber = doc.lines;
            ch = Number.MAX_VALUE;
        }
        var line = doc.line(lineNumber);
        ch = Math.min(Math.max(0, ch), line.to - line.from);
        return new Pos(lineNumber - 1, ch);
    }
    ;
    getValue() {
        return this.cm6.state.doc.toString();
    }
    ;
    setValue(text) {
        var cm = this.cm6;
        return cm.dispatch({
            changes: { from: 0, to: cm.state.doc.length, insert: text },
            selection: EditorSelection.range(0, 0)
        });
    }
    ;
    focus() {
        return this.cm6.focus();
    }
    ;
    blur() {
        return this.cm6.contentDOM.blur();
    }
    ;
    defaultTextHeight() {
        return this.cm6.defaultLineHeight;
    }
    ;
    findMatchingBracket(pos, _options) {
        var state = this.cm6.state;
        var offset = indexFromPos(state.doc, pos);
        var m = matchBrackets(state, offset + 1, -1);
        if (m && m.end) {
            return { to: posFromIndex(state.doc, m.end.from) };
        }
        m = matchBrackets(state, offset, 1);
        if (m && m.end) {
            return { to: posFromIndex(state.doc, m.end.from) };
        }
        return { to: undefined };
    }
    ;
    scanForBracket(pos, dir, style, config) {
        return scanForBracket(this, pos, dir, style, config);
    }
    ;
    indentLine(line, more) {
        // todo how to indent only one line instead of selection
        if (more)
            this.indentMore();
        else
            this.indentLess();
    }
    ;
    indentMore() {
        indentMore(this.cm6);
    }
    ;
    indentLess() {
        indentLess(this.cm6);
    }
    ;
    execCommand(name) {
        if (CodeMirror.commands.hasOwnProperty(name))
            CodeMirror.commands[name](this);
        else if (name == "goLineLeft")
            cursorLineBoundaryBackward(this.cm6);
        else if (name == "goLineRight") {
            cursorLineBoundaryForward(this.cm6);
            let state = this.cm6.state;
            let cur = state.selection.main.head;
            if (cur < state.doc.length && state.sliceDoc(cur, cur + 1) !== "\n") {
                cursorCharBackward(this.cm6);
            }
        }
        else
            console.log(name + " is not implemented");
    }
    ;
    setBookmark(cursor, options) {
        var assoc = (options === null || options === void 0 ? void 0 : options.insertLeft) ? 1 : -1;
        var offset = this.indexFromPos(cursor);
        var bm = new Marker(this, offset, assoc);
        return bm;
    }
    ;
    addOverlay({ query }) {
        let cm6Query = new SearchQuery({
            regexp: true,
            search: query.source,
            caseSensitive: !/i/.test(query.flags),
        });
        if (cm6Query.valid) {
            cm6Query.forVim = true;
            this.cm6Query = cm6Query;
            let effect = setSearchQuery.of(cm6Query);
            this.cm6.dispatch({ effects: effect });
            return cm6Query;
        }
    }
    ;
    removeOverlay(overlay) {
        if (!this.cm6Query)
            return;
        this.cm6Query.forVim = false;
        let effect = setSearchQuery.of(this.cm6Query);
        this.cm6.dispatch({ effects: effect });
    }
    ;
    getSearchCursor(query, pos) {
        var cm = this;
        var last = null;
        var lastCM5Result = null;
        var afterEmptyMatch = false;
        if (pos.ch == undefined)
            pos.ch = Number.MAX_VALUE;
        var firstOffset = indexFromPos(cm.cm6.state.doc, pos);
        var source = query.source.replace(/(\\.|{(?:\d+(?:,\d*)?|,\d+)})|[{}]/g, function (a, b) {
            if (!b)
                return "\\" + a;
            return b;
        });
        function rCursor(doc, from = 0, to = doc.length) {
            return new RegExpCursor(doc, source, { ignoreCase: query.ignoreCase }, from, to);
        }
        function nextMatch(from) {
            var doc = cm.cm6.state.doc;
            if (from > doc.length)
                return null;
            let res = rCursor(doc, from).next();
            return res.done ? null : res.value;
        }
        var ChunkSize = 10000;
        function prevMatchInRange(from, to) {
            var doc = cm.cm6.state.doc;
            for (let size = 1;; size++) {
                let start = Math.max(from, to - size * ChunkSize);
                let cursor = rCursor(doc, start, to), range = null;
                while (!cursor.next().done)
                    range = cursor.value;
                if (range && (start == from || range.from > start + 10))
                    return range;
                if (start == from)
                    return null;
            }
        }
        return {
            findNext: function () { return this.find(false); },
            findPrevious: function () { return this.find(true); },
            find: function (back) {
                var doc = cm.cm6.state.doc;
                if (back) {
                    let endAt = last ? (afterEmptyMatch ? last.to - 1 : last.from) : firstOffset;
                    last = prevMatchInRange(0, endAt);
                }
                else {
                    let startFrom = last ? (afterEmptyMatch ? last.to + 1 : last.to) : firstOffset;
                    last = nextMatch(startFrom);
                }
                lastCM5Result = last && {
                    from: posFromIndex(doc, last.from),
                    to: posFromIndex(doc, last.to),
                    match: last.match,
                };
                afterEmptyMatch = last ? last.from == last.to : false;
                return last && last.match;
            },
            from: function () { return lastCM5Result === null || lastCM5Result === void 0 ? void 0 : lastCM5Result.from; },
            to: function () { return lastCM5Result === null || lastCM5Result === void 0 ? void 0 : lastCM5Result.to; },
            replace: function (text) {
                if (last) {
                    dispatchChange(cm, {
                        changes: { from: last.from, to: last.to, insert: text }
                    });
                    last.to = last.from + text.length;
                    if (lastCM5Result) {
                        lastCM5Result.to = posFromIndex(cm.cm6.state.doc, last.to);
                    }
                }
            },
            get match() {
                return lastCM5Result && lastCM5Result.match;
            }
        };
    }
    ;
    findPosV(start, amount, unit, goalColumn) {
        let { cm6 } = this;
        const doc = cm6.state.doc;
        let pixels = unit == 'page' ? cm6.dom.clientHeight : 0;
        const startOffset = indexFromPos(doc, start);
        let range = EditorSelection.cursor(startOffset, 1, undefined, goalColumn);
        let count = Math.round(Math.abs(amount));
        for (let i = 0; i < count; i++) {
            if (unit == 'page') {
                range = cm6.moveVertically(range, amount > 0, pixels);
            }
            else if (unit == 'line') {
                range = cm6.moveVertically(range, amount > 0);
            }
        }
        let pos = posFromIndex(doc, range.head);
        // set hitside to true if there was no place to move and cursor was clipped to the edge
        // of document. Needed for gj/gk
        if ((amount < 0 &&
            range.head == 0 && goalColumn != 0 &&
            start.line == 0 && start.ch != 0) || (amount > 0 &&
            range.head == doc.length && pos.ch != goalColumn
            && start.line == pos.line)) {
            pos.hitSide = true;
        }
        return pos;
    }
    ;
    charCoords(pos, mode) {
        var rect = this.cm6.contentDOM.getBoundingClientRect();
        var offset = indexFromPos(this.cm6.state.doc, pos);
        var coords = this.cm6.coordsAtPos(offset);
        var d = -rect.top;
        return { left: ((coords === null || coords === void 0 ? void 0 : coords.left) || 0) - rect.left, top: ((coords === null || coords === void 0 ? void 0 : coords.top) || 0) + d, bottom: ((coords === null || coords === void 0 ? void 0 : coords.bottom) || 0) + d };
    }
    ;
    coordsChar(coords, mode) {
        var rect = this.cm6.contentDOM.getBoundingClientRect();
        var offset = this.cm6.posAtCoords({ x: coords.left + rect.left, y: coords.top + rect.top }) || 0;
        return posFromIndex(this.cm6.state.doc, offset);
    }
    ;
    getScrollInfo() {
        var scroller = this.cm6.scrollDOM;
        return {
            left: scroller.scrollLeft, top: scroller.scrollTop,
            height: scroller.scrollHeight,
            width: scroller.scrollWidth,
            clientHeight: scroller.clientHeight, clientWidth: scroller.clientWidth
        };
    }
    ;
    scrollTo(x, y) {
        if (x != null)
            this.cm6.scrollDOM.scrollLeft = x;
        if (y != null)
            this.cm6.scrollDOM.scrollTop = y;
    }
    ;
    scrollIntoView(pos, margin) {
        if (pos) {
            var offset = this.indexFromPos(pos);
            this.cm6.dispatch({
                effects: EditorView.scrollIntoView(offset)
            });
        }
        else {
            this.cm6.dispatch({ scrollIntoView: true, userEvent: "scroll" });
        }
    }
    ;
    getWrapperElement() {
        return this.cm6.dom;
    }
    ;
    // for tests
    getMode() {
        return { name: this.getOption("mode") };
    }
    ;
    setSize(w, h) {
        this.cm6.dom.style.width = w + 4 + "px";
        this.cm6.dom.style.height = h + "px";
        this.refresh();
    }
    refresh() {
        this.cm6.measure();
    }
    // event listeners
    destroy() {
        this.removeOverlay();
    }
    ;
    getLastEditEnd() {
        return this.posFromIndex(this.$lastChangeEndOffset);
    }
    ;
    onChange(update) {
        if (this.$lineHandleChanges) {
            this.$lineHandleChanges.push(update);
        }
        for (let i in this.marks) {
            let m = this.marks[i];
            m.update(update.changes);
        }
        if (this.virtualSelection) {
            this.virtualSelection.ranges = this.virtualSelection.ranges.map(range => range.map(update.changes));
        }
        var curOp = this.curOp = this.curOp || {};
        update.changes.iterChanges((fromA, toA, fromB, toB, text) => {
            if (curOp.$changeStart == null || curOp.$changeStart > fromB)
                curOp.$changeStart = fromB;
            this.$lastChangeEndOffset = toB;
            var change = { text: text.toJSON() };
            if (!curOp.lastChange) {
                curOp.lastChange = curOp.change = change;
            }
            else {
                curOp.lastChange.next = curOp.lastChange = change;
            }
        }, true);
        if (!curOp.changeHandlers)
            curOp.changeHandlers = this._handlers["change"] && this._handlers["change"].slice();
    }
    ;
    onSelectionChange() {
        var curOp = this.curOp = this.curOp || {};
        if (!curOp.cursorActivityHandlers)
            curOp.cursorActivityHandlers = this._handlers["cursorActivity"] && this._handlers["cursorActivity"].slice();
        this.curOp.cursorActivity = true;
    }
    ;
    operation(fn, force) {
        if (!this.curOp)
            this.curOp = { $d: 0 };
        this.curOp.$d++;
        try {
            var result = fn();
        }
        finally {
            if (this.curOp) {
                this.curOp.$d--;
                if (!this.curOp.$d)
                    this.onBeforeEndOperation();
            }
        }
        return result;
    }
    ;
    onBeforeEndOperation() {
        var op = this.curOp;
        var scrollIntoView = false;
        if (op) {
            if (op.change) {
                signalTo(op.changeHandlers, this, op.change);
            }
            if (op && op.cursorActivity) {
                signalTo(op.cursorActivityHandlers, this, null);
                if (op.isVimOp)
                    scrollIntoView = true;
            }
            this.curOp = null;
        }
        if (scrollIntoView)
            this.scrollIntoView();
    }
    ;
    moveH(increment, unit) {
        if (unit == 'char') {
            // todo
            var cur = this.getCursor();
            this.setCursor(cur.line, cur.ch + increment);
        }
    }
    ;
    setOption(name, val) {
        switch (name) {
            case "keyMap":
                this.state.keyMap = val;
                break;
            case "textwidth":
                this.state.textwidth = val;
                break;
        }
    }
    ;
    getOption(name) {
        switch (name) {
            case "firstLineNumber": return 1;
            case "tabSize": return this.cm6.state.tabSize || 4;
            case "readOnly": return this.cm6.state.readOnly;
            case "indentWithTabs": return this.cm6.state.facet(indentUnit) == "\t"; // TODO
            case "indentUnit": return this.cm6.state.facet(indentUnit).length || 2;
            case "textwidth": return this.state.textwidth;
            // for tests
            case "keyMap": return this.state.keyMap || "vim";
        }
    }
    ;
    toggleOverwrite(on) {
        this.state.overwrite = on;
    }
    ;
    getTokenTypeAt(pos) {
        var _a;
        // only comment|string are needed
        var offset = this.indexFromPos(pos);
        var tree = ensureSyntaxTree(this.cm6.state, offset);
        var node = tree === null || tree === void 0 ? void 0 : tree.resolve(offset);
        var type = ((_a = node === null || node === void 0 ? void 0 : node.type) === null || _a === void 0 ? void 0 : _a.name) || "";
        if (/comment/i.test(type))
            return "comment";
        if (/string/i.test(type))
            return "string";
        return "";
    }
    ;
    overWriteSelection(text) {
        var doc = this.cm6.state.doc;
        var sel = this.cm6.state.selection;
        var ranges = sel.ranges.map(x => {
            if (x.empty) {
                var ch = x.to < doc.length ? doc.sliceString(x.from, x.to + 1) : "";
                if (ch && !/\n/.test(ch))
                    return EditorSelection.range(x.from, x.to + 1);
            }
            return x;
        });
        this.cm6.dispatch({
            selection: EditorSelection.create(ranges, sel.mainIndex)
        });
        this.replaceSelection(text);
    }
    /*** multiselect ****/
    isInMultiSelectMode() {
        return this.cm6.state.selection.ranges.length > 1;
    }
    virtualSelectionMode() {
        return !!this.virtualSelection;
    }
    forEachSelection(command) {
        var selection = this.cm6.state.selection;
        this.virtualSelection = EditorSelection.create(selection.ranges, selection.mainIndex);
        for (var i = 0; i < this.virtualSelection.ranges.length; i++) {
            var range = this.virtualSelection.ranges[i];
            if (!range)
                continue;
            this.cm6.dispatch({ selection: EditorSelection.create([range]) });
            command();
            this.virtualSelection.ranges[i] = this.cm6.state.selection.ranges[0];
        }
        this.cm6.dispatch({ selection: this.virtualSelection });
        this.virtualSelection = null;
    }
    hardWrap(options) {
        return hardWrap(this, options);
    }
}
CodeMirror.isMac = typeof navigator != "undefined" && /*@__PURE__*//Mac/.test(navigator.platform);
// --------------------------
CodeMirror.Pos = Pos;
CodeMirror.StringStream = StringStream;
CodeMirror.commands = {
    toggleLineComment: function (cm) { toggleLineComment(cm.cm6); },
    cursorCharLeft: function (cm) { cursorCharLeft(cm.cm6); },
    redo: function (cm) { runHistoryCommand(cm, false); },
    undo: function (cm) { runHistoryCommand(cm, true); },
    newlineAndIndent: function (cm) {
        insertNewlineAndIndent({
            state: cm.cm6.state,
            dispatch: (tr) => {
                return dispatchChange(cm, tr);
            }
        });
    },
    indentAuto: function (cm) {
        indentSelection(cm.cm6);
    },
    newlineAndIndentContinueComment: undefined,
    save: undefined,
};
CodeMirror.isWordChar = function (ch) {
    return wordChar.test(ch);
};
CodeMirror.keys = keys;
CodeMirror.addClass = function (el, str) { };
CodeMirror.rmClass = function (el, str) { };
CodeMirror.e_preventDefault = function (e) {
    e.preventDefault();
};
CodeMirror.e_stop = function (e) {
    var _a, _b;
    (_a = e === null || e === void 0 ? void 0 : e.stopPropagation) === null || _a === void 0 ? void 0 : _a.call(e);
    (_b = e === null || e === void 0 ? void 0 : e.preventDefault) === null || _b === void 0 ? void 0 : _b.call(e);
};
CodeMirror.lookupKey = function lookupKey(key, map, handle) {
    var result = CodeMirror.keys[key];
    if (!result && /^Arrow/.test(key))
        result = CodeMirror.keys[key.slice(5)];
    if (result)
        handle(result);
};
CodeMirror.on = on;
CodeMirror.off = off;
CodeMirror.signal = signal;
CodeMirror.findMatchingTag = findMatchingTag;
CodeMirror.findEnclosingTag = findEnclosingTag;
CodeMirror.keyName = undefined;
/************* dialog *************/
function dialogDiv(cm, template, bottom) {
    var dialog = document.createElement("div");
    dialog.appendChild(template);
    return dialog;
}
function closeNotification(cm, newVal) {
    if (cm.state.currentNotificationClose)
        cm.state.currentNotificationClose();
    cm.state.currentNotificationClose = newVal;
}
function openNotification(cm, template, options) {
    closeNotification(cm, close);
    var dialog = dialogDiv(cm, template, options && options.bottom);
    var closed = false;
    var doneTimer;
    var duration = options && typeof options.duration !== "undefined" ? options.duration : 5000;
    function close() {
        if (closed)
            return;
        closed = true;
        clearTimeout(doneTimer);
        dialog.remove();
        hideDialog(cm, dialog);
    }
    dialog.onclick = function (e) {
        e.preventDefault();
        close();
    };
    showDialog(cm, dialog);
    if (duration)
        doneTimer = setTimeout(close, duration);
    return close;
}
function showDialog(cm, dialog) {
    var oldDialog = cm.state.dialog;
    cm.state.dialog = dialog;
    dialog.style.flex = "1";
    if (dialog && oldDialog !== dialog) {
        if (oldDialog && oldDialog.contains(document.activeElement))
            cm.focus();
        if (oldDialog && oldDialog.parentElement) {
            oldDialog.parentElement.replaceChild(dialog, oldDialog);
        }
        else if (oldDialog) {
            oldDialog.remove();
        }
        CodeMirror.signal(cm, "dialog");
    }
}
function hideDialog(cm, dialog) {
    if (cm.state.dialog == dialog) {
        cm.state.dialog = null;
        CodeMirror.signal(cm, "dialog");
    }
}
function openDialog(me, template, callback, options) {
    if (!options)
        options = {};
    closeNotification(me, undefined);
    var dialog = dialogDiv(me, template, options.bottom);
    var closed = false;
    showDialog(me, dialog);
    function close(newVal) {
        if (typeof newVal == 'string') {
            inp.value = newVal;
        }
        else {
            if (closed)
                return;
            closed = true;
            hideDialog(me, dialog);
            if (!me.state.dialog)
                me.focus();
            if (options.onClose)
                options.onClose(dialog);
        }
    }
    var inp = dialog.getElementsByTagName("input")[0];
    if (inp) {
        if (options.value) {
            inp.value = options.value;
            if (options.selectValueOnOpen !== false)
                inp.select();
        }
        if (options.onInput)
            CodeMirror.on(inp, "input", function (e) { options.onInput(e, inp.value, close); });
        if (options.onKeyUp)
            CodeMirror.on(inp, "keyup", function (e) { options.onKeyUp(e, inp.value, close); });
        CodeMirror.on(inp, "keydown", function (e) {
            if (options && options.onKeyDown && options.onKeyDown(e, inp.value, close)) {
                return;
            }
            if (e.keyCode == 13)
                callback && callback(inp.value);
            if (e.keyCode == 27 || (options.closeOnEnter !== false && e.keyCode == 13)) {
                inp.blur();
                CodeMirror.e_stop(e);
                close();
            }
        });
        if (options.closeOnBlur !== false)
            CodeMirror.on(inp, "blur", function () {
                setTimeout(function () {
                    if (document.activeElement === inp)
                        return;
                    close();
                });
            });
        inp.focus();
    }
    return close;
}
var matching = { "(": ")>", ")": "(<", "[": "]>", "]": "[<", "{": "}>", "}": "{<", "<": ">>", ">": "<<" };
function bracketRegex(config) {
    return config && config.bracketRegex || /[(){}[\]]/;
}
function scanForBracket(cm, where, dir, style, config) {
    var maxScanLen = (config && config.maxScanLineLength) || 10000;
    var maxScanLines = (config && config.maxScanLines) || 1000;
    var stack = [];
    var re = bracketRegex(config);
    var lineEnd = dir > 0 ? Math.min(where.line + maxScanLines, cm.lastLine() + 1)
        : Math.max(cm.firstLine() - 1, where.line - maxScanLines);
    for (var lineNo = where.line; lineNo != lineEnd; lineNo += dir) {
        var line = cm.getLine(lineNo);
        if (!line)
            continue;
        var pos = dir > 0 ? 0 : line.length - 1, end = dir > 0 ? line.length : -1;
        if (line.length > maxScanLen)
            continue;
        if (lineNo == where.line)
            pos = where.ch - (dir < 0 ? 1 : 0);
        for (; pos != end; pos += dir) {
            var ch = line.charAt(pos);
            if (re.test(ch) /*&& (style === undefined ||
                                (cm.getTokenTypeAt(new Pos(lineNo, pos + 1)) || "") == (style || ""))*/) {
                var match = matching[ch];
                if (match && (match.charAt(1) == ">") == (dir > 0))
                    stack.push(ch);
                else if (!stack.length)
                    return { pos: new Pos(lineNo, pos), ch: ch };
                else
                    stack.pop();
            }
        }
    }
    return lineNo - dir == (dir > 0 ? cm.lastLine() : cm.firstLine()) ? false : null;
}
function findMatchingTag(cm, pos) {
    return null;
}
function findEnclosingTag(cm, pos) {
    var _a, _b;
    var state = cm.cm6.state;
    var offset = cm.indexFromPos(pos);
    if (offset < state.doc.length) {
        var text = state.sliceDoc(offset, offset + 1);
        if (text == "<")
            offset++;
    }
    var tree = ensureSyntaxTree(state, offset);
    var node = (tree === null || tree === void 0 ? void 0 : tree.resolve(offset)) || null;
    while (node) {
        if (((_a = node.firstChild) === null || _a === void 0 ? void 0 : _a.type.name) == 'OpenTag'
            && ((_b = node.lastChild) === null || _b === void 0 ? void 0 : _b.type.name) == 'CloseTag') {
            return {
                open: convertRange(state.doc, node.firstChild),
                close: convertRange(state.doc, node.lastChild),
            };
        }
        node = node.parent;
    }
}
function convertRange(doc, cm6Range) {
    return {
        from: posFromIndex(doc, cm6Range.from),
        to: posFromIndex(doc, cm6Range.to)
    };
}
class Marker {
    constructor(cm, offset, assoc) {
        this.cm = cm;
        this.id = cm.$mid++;
        this.offset = offset;
        this.assoc = assoc;
        cm.marks[this.id] = this;
    }
    ;
    clear() { delete this.cm.marks[this.id]; }
    ;
    find() {
        if (this.offset == null)
            return null;
        return this.cm.posFromIndex(this.offset);
    }
    ;
    update(change) {
        if (this.offset != null)
            this.offset = change.mapPos(this.offset, this.assoc, MapMode.TrackDel);
    }
}
function hardWrap(cm, options) {
    var _a;
    var max = options.column || cm.getOption('textwidth') || 80;
    var allowMerge = options.allowMerge != false;
    var row = Math.min(options.from, options.to);
    var endRow = Math.max(options.from, options.to);
    while (row <= endRow) {
        var line = cm.getLine(row);
        if (line.length > max) {
            var space = findSpace(line, max, 5);
            if (space) {
                var indentation = (_a = /^\s*/.exec(line)) === null || _a === void 0 ? void 0 : _a[0];
                cm.replaceRange("\n" + indentation, new Pos(row, space.start), new Pos(row, space.end));
            }
            endRow++;
        }
        else if (allowMerge && /\S/.test(line) && row != endRow) {
            var nextLine = cm.getLine(row + 1);
            if (nextLine && /\S/.test(nextLine)) {
                var trimmedLine = line.replace(/\s+$/, "");
                var trimmedNextLine = nextLine.replace(/^\s+/, "");
                var mergedLine = trimmedLine + " " + trimmedNextLine;
                var space = findSpace(mergedLine, max, 5);
                if (space && space.start > trimmedLine.length || mergedLine.length < max) {
                    cm.replaceRange(" ", new Pos(row, trimmedLine.length), new Pos(row + 1, nextLine.length - trimmedNextLine.length));
                    row--;
                    endRow--;
                }
                else if (trimmedLine.length < line.length) {
                    cm.replaceRange("", new Pos(row, trimmedLine.length), new Pos(row, line.length));
                }
            }
        }
        row++;
    }
    return row;
    function findSpace(line, max, min) {
        if (line.length < max)
            return;
        var before = line.slice(0, max);
        var after = line.slice(max);
        var spaceAfter = /^(?:(\s+)|(\S+)(\s+))/.exec(after);
        var spaceBefore = /(?:(\s+)|(\s+)(\S+))$/.exec(before);
        var start = 0;
        var end = 0;
        if (spaceBefore && !spaceBefore[2]) {
            start = max - spaceBefore[1].length;
            end = max;
        }
        if (spaceAfter && !spaceAfter[2]) {
            if (!start)
                start = max;
            end = max + spaceAfter[1].length;
        }
        if (start) {
            return {
                start: start,
                end: end
            };
        }
        if (spaceBefore && spaceBefore[2] && spaceBefore.index > min) {
            return {
                start: spaceBefore.index,
                end: spaceBefore.index + spaceBefore[2].length
            };
        }
        if (spaceAfter && spaceAfter[2]) {
            start = max + spaceAfter[2].length;
            return {
                start: start,
                end: start + spaceAfter[3].length
            };
        }
    }
}

// backwards compatibility for old versions not supporting getDrawSelectionConfig
let getDrawSelectionConfig = View.getDrawSelectionConfig || /*@__PURE__*/function () {
    let defaultConfig = { cursorBlinkRate: 1200 };
    return function () {
        return defaultConfig;
    };
}();
class Piece {
    constructor(left, top, height, fontFamily, fontSize, fontWeight, color, className, letter, partial) {
        this.left = left;
        this.top = top;
        this.height = height;
        this.fontFamily = fontFamily;
        this.fontSize = fontSize;
        this.fontWeight = fontWeight;
        this.color = color;
        this.className = className;
        this.letter = letter;
        this.partial = partial;
    }
    draw() {
        let elt = document.createElement("div");
        elt.className = this.className;
        this.adjust(elt);
        return elt;
    }
    adjust(elt) {
        elt.style.left = this.left + "px";
        elt.style.top = this.top + "px";
        elt.style.height = this.height + "px";
        elt.style.lineHeight = this.height + "px";
        elt.style.fontFamily = this.fontFamily;
        elt.style.fontSize = this.fontSize;
        elt.style.fontWeight = this.fontWeight;
        elt.style.color = this.partial ? "transparent" : this.color;
        elt.className = this.className;
        elt.textContent = this.letter;
    }
    eq(p) {
        return this.left == p.left && this.top == p.top && this.height == p.height &&
            this.fontFamily == p.fontFamily && this.fontSize == p.fontSize &&
            this.fontWeight == p.fontWeight && this.color == p.color &&
            this.className == p.className &&
            this.letter == p.letter;
    }
}
class BlockCursorPlugin {
    constructor(view, cm) {
        this.view = view;
        this.rangePieces = [];
        this.cursors = [];
        this.cm = cm;
        this.measureReq = { read: this.readPos.bind(this), write: this.drawSel.bind(this) };
        this.cursorLayer = view.scrollDOM.appendChild(document.createElement("div"));
        this.cursorLayer.className = "cm-cursorLayer cm-vimCursorLayer";
        this.cursorLayer.setAttribute("aria-hidden", "true");
        view.requestMeasure(this.measureReq);
        this.setBlinkRate();
    }
    setBlinkRate() {
        let config = getDrawSelectionConfig(this.cm.cm6.state);
        let blinkRate = config.cursorBlinkRate;
        this.cursorLayer.style.animationDuration = blinkRate + "ms";
    }
    update(update) {
        if (update.selectionSet || update.geometryChanged || update.viewportChanged) {
            this.view.requestMeasure(this.measureReq);
            this.cursorLayer.style.animationName = this.cursorLayer.style.animationName == "cm-blink" ? "cm-blink2" : "cm-blink";
        }
        if (configChanged(update))
            this.setBlinkRate();
    }
    scheduleRedraw() {
        this.view.requestMeasure(this.measureReq);
    }
    readPos() {
        let { state } = this.view;
        let cursors = [];
        for (let r of state.selection.ranges) {
            let prim = r == state.selection.main;
            let piece = measureCursor(this.cm, this.view, r, prim);
            if (piece)
                cursors.push(piece);
        }
        return { cursors };
    }
    drawSel({ cursors }) {
        if (cursors.length != this.cursors.length || cursors.some((c, i) => !c.eq(this.cursors[i]))) {
            let oldCursors = this.cursorLayer.children;
            if (oldCursors.length !== cursors.length) {
                this.cursorLayer.textContent = "";
                for (const c of cursors)
                    this.cursorLayer.appendChild(c.draw());
            }
            else {
                cursors.forEach((c, idx) => c.adjust(oldCursors[idx]));
            }
            this.cursors = cursors;
        }
    }
    destroy() {
        this.cursorLayer.remove();
    }
}
function configChanged(update) {
    return getDrawSelectionConfig(update.startState) != getDrawSelectionConfig(update.state);
}
const themeSpec = {
    ".cm-vimMode .cm-line": {
        "& ::selection": { backgroundColor: "transparent !important" },
        "&::selection": { backgroundColor: "transparent !important" },
        caretColor: "transparent !important",
    },
    ".cm-fat-cursor": {
        position: "absolute",
        background: "#ff9696",
        border: "none",
        whiteSpace: "pre",
    },
    "&:not(.cm-focused) .cm-fat-cursor": {
        background: "none",
        outline: "solid 1px #ff9696",
        color: "transparent !important",
    },
};
const hideNativeSelection = /*@__PURE__*/Prec.highest(/*@__PURE__*/EditorView.theme(themeSpec));
function getBase(view) {
    let rect = view.scrollDOM.getBoundingClientRect();
    let left = view.textDirection == Direction.LTR ? rect.left : rect.right - view.scrollDOM.clientWidth;
    return { left: left - view.scrollDOM.scrollLeft * view.scaleX, top: rect.top - view.scrollDOM.scrollTop * view.scaleY };
}
function measureCursor(cm, view, cursor, primary) {
    var _a, _b, _c, _d;
    let head = cursor.head;
    let fatCursor = false;
    let hCoeff = 1;
    let vim = cm.state.vim;
    if (vim && (!vim.insertMode || cm.state.overwrite)) {
        fatCursor = true;
        if (vim.visualBlock && !primary)
            return null;
        if (cursor.anchor < cursor.head) {
            let letter = head < view.state.doc.length && view.state.sliceDoc(head, head + 1);
            if (letter != "\n")
                head--;
        }
        if (cm.state.overwrite)
            hCoeff = 0.2;
        else if (vim.status)
            hCoeff = 0.5;
    }
    if (fatCursor) {
        let letter = head < view.state.doc.length && view.state.sliceDoc(head, head + 1);
        if (letter && (/[\uDC00-\uDFFF]/.test(letter) && head > 1)) {
            // step back if cursor is on the second half of a surrogate pair
            head--;
            letter = view.state.sliceDoc(head, head + 1);
        }
        let pos = view.coordsAtPos(head, 1);
        if (!pos)
            return null;
        let base = getBase(view);
        let domAtPos = view.domAtPos(head);
        let node = domAtPos ? domAtPos.node : view.contentDOM;
        if (node instanceof Text && domAtPos.offset >= node.data.length) {
            if ((_a = node.parentElement) === null || _a === void 0 ? void 0 : _a.nextSibling) {
                node = (_b = node.parentElement) === null || _b === void 0 ? void 0 : _b.nextSibling;
                domAtPos = { node: node, offset: 0 };
            }
        }
        while (domAtPos && domAtPos.node instanceof HTMLElement) {
            node = domAtPos.node;
            domAtPos = { node: domAtPos.node.childNodes[domAtPos.offset], offset: 0 };
        }
        if (!(node instanceof HTMLElement)) {
            if (!node.parentNode)
                return null;
            node = node.parentNode;
        }
        let style = getComputedStyle(node);
        let left = pos.left;
        // TODO remove coordsAtPos when all supported versions of codemirror have coordsForChar api
        let charCoords = (_d = (_c = view).coordsForChar) === null || _d === void 0 ? void 0 : _d.call(_c, head);
        if (charCoords) {
            left = charCoords.left;
        }
        if (!letter || letter == "\n" || letter == "\r") {
            letter = "\xa0";
        }
        else if (letter == "\t") {
            letter = "\xa0";
            var nextPos = view.coordsAtPos(head + 1, -1);
            if (nextPos) {
                left = nextPos.left - (nextPos.left - pos.left) / parseInt(style.tabSize);
            }
        }
        else if ((/[\uD800-\uDBFF]/.test(letter) && head < view.state.doc.length - 1)) {
            // include the second half of a surrogate pair in cursor
            letter += view.state.sliceDoc(head + 1, head + 2);
        }
        let h = (pos.bottom - pos.top);
        return new Piece((left - base.left) / view.scaleX, (pos.top - base.top + h * (1 - hCoeff)) / view.scaleY, h * hCoeff / view.scaleY, style.fontFamily, style.fontSize, style.fontWeight, style.color, primary ? "cm-fat-cursor cm-cursor-primary" : "cm-fat-cursor cm-cursor-secondary", letter, hCoeff != 1);
    }
    else {
        return null;
    }
}

var FIREFOX_LINUX = typeof navigator != "undefined"
    && /*@__PURE__*//linux/i.test(navigator.platform)
    && /*@__PURE__*// Gecko\/\d+/.exec(navigator.userAgent);
const Vim = /*@__PURE__*/initVim(CodeMirror);
const HighlightMargin = 250;
const vimStyle = /*@__PURE__*/EditorView.baseTheme({
    ".cm-vimMode .cm-cursorLayer:not(.cm-vimCursorLayer)": {
        display: "none",
    },
    ".cm-vim-panel": {
        padding: "0px 10px",
        fontFamily: "monospace",
        minHeight: "1.3em",
        display: 'flex',
    },
    ".cm-vim-panel input": {
        border: "none",
        outline: "none",
        backgroundColor: "inherit",
    },
    "&light .cm-searchMatch": { backgroundColor: "#ffff0054" },
    "&dark .cm-searchMatch": { backgroundColor: "#00ffff8a" },
});
const vimPlugin = /*@__PURE__*/ViewPlugin.fromClass(class {
    constructor(view) {
        this.status = "";
        this.query = null;
        this.decorations = Decoration.none;
        this.waitForCopy = false;
        this.lastKeydown = '';
        this.useNextTextInput = false;
        this.compositionText = '';
        this.view = view;
        const cm = (this.cm = new CodeMirror(view));
        Vim.enterVimMode(this.cm);
        this.view.cm = this.cm;
        this.cm.state.vimPlugin = this;
        this.blockCursor = new BlockCursorPlugin(view, cm);
        this.updateClass();
        this.cm.on("vim-command-done", () => {
            if (cm.state.vim)
                cm.state.vim.status = "";
            this.blockCursor.scheduleRedraw();
            this.updateStatus();
        });
        this.cm.on("vim-mode-change", (e) => {
            if (!cm.state.vim)
                return;
            cm.state.vim.mode = e.mode;
            if (e.subMode) {
                cm.state.vim.mode += e.subMode === "linewise" ? " line" : " block";
            }
            cm.state.vim.status = "";
            this.blockCursor.scheduleRedraw();
            this.updateClass();
            this.updateStatus();
        });
        this.cm.on("dialog", () => {
            if (this.cm.state.statusbar) {
                this.updateStatus();
            }
            else {
                view.dispatch({
                    effects: showVimPanel.of(!!this.cm.state.dialog),
                });
            }
        });
        this.dom = document.createElement("span");
        this.spacer = document.createElement("span");
        this.spacer.style.flex = "1";
        this.statusButton = document.createElement("span");
        this.statusButton.onclick = (e) => {
            Vim.handleKey(this.cm, "<Esc>", "user");
            this.cm.focus();
        };
        this.statusButton.style.cssText = "cursor: pointer";
    }
    update(update) {
        var _a;
        if ((update.viewportChanged || update.docChanged) && this.query) {
            this.highlight(this.query);
        }
        if (update.docChanged) {
            this.cm.onChange(update);
        }
        if (update.selectionSet) {
            this.cm.onSelectionChange();
        }
        if (update.viewportChanged) ;
        if (this.cm.curOp && !this.cm.curOp.isVimOp) {
            this.cm.onBeforeEndOperation();
        }
        if (update.transactions) {
            for (let tr of update.transactions)
                for (let effect of tr.effects) {
                    if (effect.is(setSearchQuery)) {
                        let forVim = (_a = effect.value) === null || _a === void 0 ? void 0 : _a.forVim;
                        if (!forVim) {
                            this.highlight(null);
                        }
                        else {
                            let query = effect.value.create();
                            this.highlight(query);
                        }
                    }
                }
        }
        this.blockCursor.update(update);
    }
    updateClass() {
        const state = this.cm.state;
        if (!state.vim || (state.vim.insertMode && !state.overwrite))
            this.view.scrollDOM.classList.remove("cm-vimMode");
        else
            this.view.scrollDOM.classList.add("cm-vimMode");
    }
    updateStatus() {
        let dom = this.cm.state.statusbar;
        let vim = this.cm.state.vim;
        if (!dom || !vim)
            return;
        let dialog = this.cm.state.dialog;
        if (dialog) {
            if (dialog.parentElement != dom) {
                dom.textContent = "";
                dom.appendChild(dialog);
            }
        }
        else {
            dom.textContent = "";
            var status = (vim.mode || "normal").toUpperCase();
            if (vim.insertModeReturn)
                status += "(C-O)";
            this.statusButton.textContent = `--${status}--`;
            dom.appendChild(this.statusButton);
            dom.appendChild(this.spacer);
        }
        this.dom.textContent = vim.status;
        dom.appendChild(this.dom);
    }
    destroy() {
        Vim.leaveVimMode(this.cm);
        this.updateClass();
        this.blockCursor.destroy();
        delete this.view.cm;
    }
    highlight(query) {
        this.query = query;
        if (!query)
            return (this.decorations = Decoration.none);
        let { view } = this;
        let builder = new RangeSetBuilder();
        for (let i = 0, ranges = view.visibleRanges, l = ranges.length; i < l; i++) {
            let { from, to } = ranges[i];
            while (i < l - 1 && to > ranges[i + 1].from - 2 * HighlightMargin)
                to = ranges[++i].to;
            query.highlight(view.state, from, to, (from, to) => {
                builder.add(from, to, matchMark);
            });
        }
        return (this.decorations = builder.finish());
    }
    handleKey(e, view) {
        const cm = this.cm;
        let vim = cm.state.vim;
        if (!vim)
            return;
        const key = Vim.vimKeyFromEvent(e, vim);
        CodeMirror.signal(this.cm, 'inputEvent', { type: "handleKey", key });
        if (!key)
            return;
        // clear search highlight
        if (key == "<Esc>" &&
            !vim.insertMode &&
            !vim.visualMode &&
            this.query /* && !cm.inMultiSelectMode*/) {
            const searchState = vim.searchState_;
            if (searchState) {
                cm.removeOverlay(searchState.getOverlay());
                searchState.setOverlay(null);
            }
        }
        let isCopy = key === "<C-c>" && !CodeMirror.isMac;
        if (isCopy && cm.somethingSelected()) {
            this.waitForCopy = true;
            return true;
        }
        vim.status = (vim.status || "") + key;
        let result = Vim.multiSelectHandleKey(cm, key, "user");
        vim = Vim.maybeInitVimState_(cm); // the object can change if there is an exception in handleKey
        // insert mode
        if (!result && vim.insertMode && cm.state.overwrite) {
            if (e.key && e.key.length == 1 && !/\n/.test(e.key)) {
                result = true;
                cm.overWriteSelection(e.key);
            }
            else if (e.key == "Backspace") {
                result = true;
                CodeMirror.commands.cursorCharLeft(cm);
            }
        }
        if (result) {
            CodeMirror.signal(this.cm, 'vim-keypress', key);
            e.preventDefault();
            e.stopPropagation();
            this.blockCursor.scheduleRedraw();
        }
        this.updateStatus();
        return !!result;
    }
}, {
    eventHandlers: {
        copy: function (e, view) {
            if (!this.waitForCopy)
                return;
            this.waitForCopy = false;
            Promise.resolve().then(() => {
                var cm = this.cm;
                var vim = cm.state.vim;
                if (!vim)
                    return;
                if (vim.insertMode) {
                    cm.setSelection(cm.getCursor(), cm.getCursor());
                }
                else {
                    cm.operation(() => {
                        if (cm.curOp)
                            cm.curOp.isVimOp = true;
                        Vim.handleKey(cm, '<Esc>', 'user');
                    });
                }
            });
        },
        compositionstart: function (e, view) {
            this.useNextTextInput = true;
            CodeMirror.signal(this.cm, 'inputEvent', e);
        },
        compositionupdate: function (e, view) {
            CodeMirror.signal(this.cm, 'inputEvent', e);
        },
        compositionend: function (e, view) {
            CodeMirror.signal(this.cm, 'inputEvent', e);
        },
        keypress: function (e, view) {
            CodeMirror.signal(this.cm, 'inputEvent', e);
            if (this.lastKeydown == "Dead")
                this.handleKey(e, view);
        },
        keydown: function (e, view) {
            CodeMirror.signal(this.cm, 'inputEvent', e);
            this.lastKeydown = e.key;
            if (this.lastKeydown == "Unidentified"
                || this.lastKeydown == "Process"
                || this.lastKeydown == "Dead") {
                this.useNextTextInput = true;
            }
            else {
                this.useNextTextInput = false;
                this.handleKey(e, view);
            }
        },
    },
    provide: () => {
        return [
            EditorView.inputHandler.of((view, from, to, text) => {
                var _a, _b;
                var cm = getCM(view);
                if (!cm)
                    return false;
                var vim = (_a = cm.state) === null || _a === void 0 ? void 0 : _a.vim;
                var vimPlugin = cm.state.vimPlugin;
                if (vim && !vim.insertMode && !((_b = cm.curOp) === null || _b === void 0 ? void 0 : _b.isVimOp)) {
                    if (text === "\0\0") {
                        return true;
                    }
                    CodeMirror.signal(cm, 'inputEvent', {
                        type: "text",
                        text,
                        from,
                        to,
                    });
                    if (text.length == 1 && vimPlugin.useNextTextInput) {
                        if (vim.expectLiteralNext && view.composing) {
                            vimPlugin.compositionText = text;
                            return false;
                        }
                        if (vimPlugin.compositionText) {
                            var toRemove = vimPlugin.compositionText;
                            vimPlugin.compositionText = '';
                            var head = view.state.selection.main.head;
                            var textInDoc = view.state.sliceDoc(head - toRemove.length, head);
                            if (toRemove === textInDoc) {
                                var pos = cm.getCursor();
                                cm.replaceRange('', cm.posFromIndex(head - toRemove.length), pos);
                            }
                        }
                        vimPlugin.handleKey({
                            key: text,
                            preventDefault: () => { },
                            stopPropagation: () => { }
                        });
                        forceEndComposition(view);
                        return true;
                    }
                }
                return false;
            })
        ];
    },
    decorations: (v) => v.decorations,
});
/**
 * removes contenteditable element and adds it back to end
 * IME composition in normal mode
 * this method works on all browsers except for Firefox on Linux
 * where we need to reset textContent of editor
 * (which doesn't work on other browsers)
 */
function forceEndComposition(view) {
    var parent = view.scrollDOM.parentElement;
    if (!parent)
        return;
    if (FIREFOX_LINUX) {
        view.contentDOM.textContent = "\0\0";
        view.contentDOM.dispatchEvent(new CustomEvent("compositionend"));
        return;
    }
    var sibling = view.scrollDOM.nextSibling;
    var selection = window.getSelection();
    var savedSelection = selection && {
        anchorNode: selection.anchorNode,
        anchorOffset: selection.anchorOffset,
        focusNode: selection.focusNode,
        focusOffset: selection.focusOffset
    };
    view.scrollDOM.remove();
    parent.insertBefore(view.scrollDOM, sibling);
    try {
        if (savedSelection && selection) {
            selection.setPosition(savedSelection.anchorNode, savedSelection.anchorOffset);
            if (savedSelection.focusNode) {
                selection.extend(savedSelection.focusNode, savedSelection.focusOffset);
            }
        }
    }
    catch (e) {
        console.error(e);
    }
    view.focus();
    view.contentDOM.dispatchEvent(new CustomEvent("compositionend"));
}
const matchMark = /*@__PURE__*/Decoration.mark({ class: "cm-searchMatch" });
const showVimPanel = /*@__PURE__*/StateEffect.define();
const vimPanelState = /*@__PURE__*/StateField.define({
    create: () => false,
    update(value, tr) {
        for (let e of tr.effects)
            if (e.is(showVimPanel))
                value = e.value;
        return value;
    },
    provide: (f) => {
        return showPanel.from(f, (on) => (on ? createVimPanel : null));
    },
});
function createVimPanel(view) {
    let dom = document.createElement("div");
    dom.className = "cm-vim-panel";
    let cm = view.cm;
    if (cm.state.dialog) {
        dom.appendChild(cm.state.dialog);
    }
    return { top: false, dom };
}
function statusPanel(view) {
    let dom = document.createElement("div");
    dom.className = "cm-vim-panel";
    let cm = view.cm;
    cm.state.statusbar = dom;
    cm.state.vimPlugin.updateStatus();
    return { dom };
}
function vim(options = {}) {
    return [
        vimStyle,
        vimPlugin,
        hideNativeSelection,
        options.status ? showPanel.of(statusPanel) : vimPanelState,
    ];
}
function getCM(view) {
    return view.cm || null;
}

export { CodeMirror, Vim, getCM, vim };
