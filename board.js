/*
 * board.js — 三消棋盘引擎（纯逻辑，不依赖任何渲染 / 框架）
 * 浏览器 / Node 双用（UMD）。
 *
 * v2 变更：
 *  - 每个格子带有 special 字段（null | 'line' | 'bomb'），用于「四连生成直线炸弹 / 拐角生成爆破弹」
 *  - 新增 findRuns()：返回每一段 3+ 连线的方向与格子，供消除特效与特殊宝石生成使用
 *  - 新增 makeCell / randType 导出，供前端做下落补位
 */
(function (global) {
  const TYPE_COUNT = 5; // 0红符文 1紫触手 2绿眼 3骨颅 4青孢
  let _idSeed = 0;

  function randType() {
    return Math.floor(Math.random() * TYPE_COUNT);
  }

  function makeCell(type) {
    return { id: ++_idSeed, type: type, special: null };
  }

  // 在 (r,c) 放置 t 是否会与已落子的左侧两个或上方两个形成初始三连
  function causesInitialMatch(board, row, c, t) {
    if (c >= 2 && row[c - 1] && row[c - 2] &&
        row[c - 1].type === t && row[c - 2].type === t) return true;
    const r = board.length; // 当前行号（尚未 push 进 board）
    if (r >= 2 && board[r - 1] && board[r - 2] &&
        board[r - 1][c] && board[r - 2][c] &&
        board[r - 1][c].type === t && board[r - 2][c].type === t) return true;
    return false;
  }

  function createBoard(rows, cols) {
    const b = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        let t;
        let guard = 0;
        do {
          t = randType();
          guard++;
        } while (causesInitialMatch(b, row, c, t) && guard < 50);
        row.push(makeCell(t));
      }
      b.push(row);
    }
    return b;
  }

  // 返回所有 3+ 连线：[{ type, dir:'h'|'v', len, cells:[{r,c}] }]
  function findRuns(board) {
    const rows = board.length;
    const cols = board[0].length;
    const runs = [];

    // 水平
    for (let r = 0; r < rows; r++) {
      let start = 0;
      for (let c = 1; c <= cols; c++) {
        const prev = board[r][start];
        const cur = c < cols ? board[r][c] : null;
        const same = !!(prev && cur && prev.type === cur.type);
        if (!same) {
          const len = c - start;
          if (len >= 3 && prev) {
            const cells = [];
            for (let k = start; k < c; k++) cells.push({ r: r, c: k });
            runs.push({ type: prev.type, dir: 'h', len: len, cells: cells });
          }
          start = c;
        }
      }
    }
    // 垂直
    for (let c = 0; c < cols; c++) {
      let start = 0;
      for (let r = 1; r <= rows; r++) {
        const prev = board[start][c];
        const cur = r < rows ? board[r][c] : null;
        const same = !!(prev && cur && prev.type === cur.type);
        if (!same) {
          const len = r - start;
          if (len >= 3 && prev) {
            const cells = [];
            for (let k = start; k < r; k++) cells.push({ r: k, c: c });
            runs.push({ type: prev.type, dir: 'v', len: len, cells: cells });
          }
          start = r;
        }
      }
    }
    return runs;
  }

  // 找出所有处于 3+ 连线中的格子（去重），返回 [{r,c}]
  function findMatches(board) {
    const seen = Object.create(null);
    const out = [];
    const runs = findRuns(board);
    for (let i = 0; i < runs.length; i++) {
      const cells = runs[i].cells;
      for (let j = 0; j < cells.length; j++) {
        const key = cells[j].r + ',' + cells[j].c;
        if (!seen[key]) { seen[key] = 1; out.push(cells[j]); }
      }
    }
    return out;
  }

  function swapCells(board, r1, c1, r2, c2) {
    const tmp = board[r1][c1];
    board[r1][c1] = board[r2][c2];
    board[r2][c2] = tmp;
  }

  function isAdjacent(r1, c1, r2, c2) {
    return Math.abs(r1 - r2) + Math.abs(c1 - c2) === 1;
  }

  // 重力下落 + 顶部补充（直接修改 board）
  function collapseAndRefill(board) {
    const rows = board.length;
    const cols = board[0].length;
    for (let c = 0; c < cols; c++) {
      let writeRow = rows - 1;
      for (let r = rows - 1; r >= 0; r--) {
        if (board[r][c]) {
          if (writeRow !== r) {
            board[writeRow][c] = board[r][c];
            board[r][c] = null;
          }
          writeRow--;
        }
      }
      for (let r = writeRow; r >= 0; r--) board[r][c] = makeCell(randType());
    }
  }

  // 完整级联（无动画版本，Node 测试 / 小程序结算用）
  function resolve(board) {
    let cascades = 0;
    let totalCleared = 0;
    const dmgByType = [0, 0, 0, 0, 0];
    while (true) {
      const matches = findMatches(board);
      if (matches.length === 0) break;
      cascades++;
      for (const m of matches) {
        dmgByType[board[m.r][m.c].type]++;
        totalCleared++;
      }
      for (const m of matches) board[m.r][m.c] = null;
      collapseAndRefill(board);
    }
    return { cascades, totalCleared, dmgByType };
  }

  function clearAndCollapse(board, matches) {
    const dmgByType = [0, 0, 0, 0, 0];
    for (const m of matches) {
      dmgByType[board[m.r][m.c].type]++;
      board[m.r][m.c] = null;
    }
    collapseAndRefill(board);
    return { dmgByType, totalCleared: matches.length };
  }

  // 死局检测：是否还存在可消除的走法
  function hasPossibleMove(board) {
    const rows = board.length;
    const cols = board[0].length;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (c + 1 < cols) {
          swapCells(board, r, c, r, c + 1);
          const ok = findMatches(board).length > 0;
          swapCells(board, r, c, r, c + 1);
          if (ok) return true;
        }
        if (r + 1 < rows) {
          swapCells(board, r, c, r + 1, c);
          const ok = findMatches(board).length > 0;
          swapCells(board, r, c, r + 1, c);
          if (ok) return true;
        }
      }
    }
    return false;
  }

  // 洗牌：保证无初始连线且至少存在一步可走
  function shuffleBoard(board) {
    const rows = board.length;
    const cols = board[0].length;

    function assign(fill) {
      let k = 0;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          if (!board[r][c]) board[r][c] = makeCell(fill[k]);
          else { board[r][c].type = fill[k]; board[r][c].special = null; }
          k++;
        }
    }

    function good() {
      return findMatches(board).length === 0 && hasPossibleMove(board);
    }

    // 先做「同色多重集内的排列」，做不出合法局面再退化为完全随机
    for (let attempt = 0; attempt < 240; attempt++) {
      const flat = [];
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) flat.push(board[r][c] ? board[r][c].type : randType());
      for (let i = flat.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = flat[i]; flat[i] = flat[j]; flat[j] = t;
      }
      assign(flat);
      if (good()) return true;
    }
    for (let attempt = 0; attempt < 200; attempt++) {
      const flat = [];
      for (let i = 0; i < rows * cols; i++) flat.push(randType());
      assign(flat);
      if (good()) return true;
    }
    return false;
  }

  const api = {
    TYPE_COUNT,
    randType,
    makeCell,
    createBoard,
    findRuns,
    findMatches,
    swapCells,
    isAdjacent,
    resolve,
    clearAndCollapse,
    hasPossibleMove,
    shuffleBoard,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.BoardLib = api;
})(typeof window !== 'undefined' ? window : this);
