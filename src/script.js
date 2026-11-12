(function() {
	"use strict";
	const W = 100,
		H = 66,
		CS = 0.12,
		PX = 6;
	const BW = 0.72,
		BH = 0.52,
		CAP = 0.10,
		V0 = 0.5; // 本体72cm×72cm、積載は最大100L
	const KG = 300; // 雪の密度[kg/m³](100L=約30kg)
	const CLR = 3.0;
	const SOFT = 5;
	const BM = 2;
	const KS = 140; // 通過する雪1m³あたりの経路コスト係数(積載率が高いほど効く)
	const SPILL = 0.012;
	const MAXRE = 40;
	const BACK = 0.6; // 後退距離[m]
	const FAILMAX = 80; // 後退の上限回数(超えたら停止)
	const T = new Uint8Array(W * H);
	const IN = new Uint8Array(W * H);
	const BAD = new Uint8Array(W * H); // 境界から出そうになった地点(値が大きいほど避ける)
	const snow = new Float32Array(W * H);
	const cv = document.getElementById('cv'),
		ctx = cv.getContext('2d');
	let tool = 4,
		R, running = false,
		last = 0,
		total0 = 0,
		zone0 = 1,
		B = null,
		BO = null;
	let BP = [],
		closed = false,
		HOME = null,
		hd = false;
	const $ = id => document.getElementById(id);
	const idx = (c, r) => r * W + c,
		inb = (c, r) => c >= 0 && r >= 0 && c < W && r < H;
	const rnd = () => {
		const d = $('depth').value / 100;
		return d * (0.7 + Math.random() * 0.6)
	};
	const cellOf = p => idx(Math.min(W - 1, Math.max(0, Math.floor(p.x / CS))),
		Math.min(H - 1, Math.max(0, Math.floor(p.y / CS))));

	function rect(c0, r0, w, h, v) {
		for (let r = r0; r < r0 + h; r++)
			for (let c = c0; c < c0 + w; c++)
				if (inb(c, r)) set(c, r, v)
	}

	function set(c, r, v) {
		const i = idx(c, r);
		T[i] = v;
		snow[i] = (v === 1) ? rnd() : 0
	}

	function sample() {
		T.fill(0);
		snow.fill(0);
		rect(10, 20, 66, 22, 1);
		rect(10, 6, 16, 14, 1);
		rect(82, 40, 15, 22, 2);
		rect(50, 26, 12, 9, 3);
		rect(30, 32, 3, 3, 3);
		BP = [{
			x: .5,
			y: .5
		}, {
			x: 11.7,
			y: .5
		}, {
			x: 11.7,
			y: 7.7
		}, {
			x: 6,
			y: 7.7
		}, {
			x: .5,
			y: 5.9
		}];
		closed = true;
		buildIN();
		B = null;
		reset()
	}

	function reset() {
		B = null;
		BAD.fill(0);
		setHome();
		hd = false;
		for (let i = 0; i < T.length; i++) snow[i] = (T[i] === 1) ? (snow[i] > 0 ?
			snow[i] : rnd()) : 0;
		const hx = HOME ? HOME.x : 1,
			hy = HOME ? HOME.y : 1;
		R = {
			x: hx,
			y: hy,
			th: 0,
			load: 0,
			queue: [],
			segs: [],
			plan: [],
			cur: null,
			resume: null,
			needDump: false,
			phase: 'work',
			home: false,
			done: false,
			err: false,
			t: 0,
			dist: 0,
			trips: 0,
			started: false,
			spill: 0,
			replans: 0,
			hist: [{
				x: hx,
				y: hy,
				th: 0
			}],
			back: 0,
			fails: 0,
			failMode: ''
		};
		running = false;
		$('run').textContent = '▶ 走行開始';
		countZone();
		msg('');
		stats();
		draw()
	}

	function countZone() {
		total0 = 0;
		zone0 = 0;
		for (let i = 0; i < T.length; i++)
			if (T[i] === 1 && IN[i]) {
				total0 += snow[i];
				zone0++
			}
	}

	function msg(s) {
		$('msg').textContent = s
	}

	// ---- 敷地境界 ----
	function pip(x, y) {
		let ins = false;
		const n = BP.length;
		for (let i = 0, j = n - 1; i < n; j = i++) {
			const a = BP[i],
				b = BP[j];
			if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) +
				a.x) ins = !ins
		}
		return ins
	}

	function buildIN() {
		IN.fill(0);
		if (!closed || BP.length < 3) return;
		for (let r = 0; r < H; r++)
			for (let c = 0; c < W; c++) IN[idx(c, r)] = pip((c + .5) * CS, (r + .5) *
				CS) ? 1 : 0
	}

	function closeB() {
		if (BP.length < 3) {
			msg('境界は3点以上で囲んでください。');
			return
		}
		closed = true;
		buildIN();
		reset();
		msg('敷地境界を設定しました。次に除雪範囲と雪置き場を敷地内に塗ってください。')
	}

	function clearB() {
		BP = [];
		closed = false;
		IN.fill(0);
		reset()
	}

	function addVertex(e) {
		const rc = cv.getBoundingClientRect(),
			x = (e.clientX - rc.left) / rc.width * W * CS,
			y = (e.clientY - rc.top) / rc.height * H * CS;
		if (closed) {
			BP = [];
			closed = false;
			IN.fill(0);
			B = null;
			hd = true
		}
		if (BP.length >= 3 && Math.hypot(x - BP[0].x, y - BP[0].y) < 0.35) {
			closeB();
			return
		}
		const l = BP[BP.length - 1];
		if (l && Math.hypot(x - l.x, y - l.y) < 0.1) return;
		BP.push({
			x, y
		});
		msg('頂点 ' + BP.length + ' 個。最初の点の近くをクリック(またはダブルクリック/「境界を閉じる」)で確定します。');
		draw()
	}

	// ---- 経路計画 ----
	function inflate() {
		B = new Float32Array(W * H).fill(99);
		BO = new Float32Array(W * H).fill(99);
		const K = 8;
		for (let r = 0; r < H; r++)
			for (let c = 0; c < W; c++) {
				const i = idx(c, r),
					ob = T[i] === 3,
					out = !IN[i];
				if (!ob && !out) continue;
				if (out) {
					let deep = true;
					for (let dr = -1; dr <= 1 && deep; dr++)
						for (let dc = -1; dc <= 1; dc++) {
							const cc = c + dc,
								rr = r + dr;
							if (inb(cc, rr) && IN[idx(cc, rr)]) {
								deep = false;
								break
							}
						}
					if (deep && !ob) {
						BO[i] = -BM;
						continue
					}
				}
				for (let dr = -K; dr <= K; dr++)
					for (let dc = -K; dc <= K; dc++) {
						const cc = c + dc,
							rr = r + dr;
						if (!inb(cc, rr)) continue;
						const d = Math.hypot(dc, dr),
							j = idx(cc, rr);
						if (ob && d < B[j]) B[j] = d;
						if (out) {
							const e = d - BM;
							if (e < BO[j]) BO[j] = e
						}
					}
			}
		for (let i = 0; i < B.length; i++)
			if (BO[i] < B[i]) B[i] = BO[i]
	}

	function setHome() {
		if (!B) inflate();
		HOME = null;
		for (let s = 0; s < W + H && !HOME; s++)
			for (let r = 0; r <= s && r < H; r++) {
				const c = s - r;
				if (c < W && B[idx(c, r)] >= CLR + 1) {
					HOME = {
						x: c * CS + CS / 2,
						y: r * CS + CS / 2
					};
					break
				}
			}
	}
	const needCell = i => T[i] === 1 && IN[i] === 1 && snow[i] > 0.004;
	const blk = i => T[i] === 3 || T[i] === 2 || !IN[i] || BAD[i] >= 2;

	function needLeft() {
		for (let i = 0; i < T.length; i++)
			if (needCell(i)) return true;
		return false
	}

	function planAt(off) {
		if (!B) inflate();
		let r0 = H,
			r1 = -1;
		for (let r = 0; r < H; r++)
			for (let c = 0; c < W; c++)
				if (needCell(idx(c, r))) {
					r0 = Math.min(r0, r);
					r1 = Math.max(r1, r)
				}
		if (r1 < 0) return {
			lanes: [],
			cover: 0
		};
		const y0 = r0 * CS,
			y1 = (r1 + 1) * CS,
			lanes = [],
			step = BW - 0.06,
			hw = BW / 2;
		let yc = Math.max(hw, y0 + hw - off),
			li = 0,
			cover = 0;
		while (true) {
			const y = Math.min(yc, Math.max(y0 + hw, y1 - hw));
			const ra = Math.max(0, Math.floor((y - hw) / CS)),
				rb = Math.min(H - 1, Math.floor((y + hw - 1e-6) / CS));
			const segs = [];
			let s = -1,
				cnt = 0;
			for (let c = 0; c <= W; c++) {
				let ok = false,
					zc = 0;
				if (c < W) {
					let bad = false;
					for (let r = ra; r <= rb; r++) {
						const i = idx(c, r);
						if (blk(i)) bad = true;
						if (needCell(i)) zc++
					}
					ok = zc > 0 && !bad
				}
				if (ok) {
					if (s < 0) {
						s = c;
						cnt = 0
					}
					cnt += zc
				}
				if (!ok && s >= 0) {
					if (c - s >= 3) segs.push({
						sx: s * CS + CS / 2,
						ex: c * CS - CS / 2,
						y,
						ra,
						rb,
						cnt
					});
					s = -1
				}
			}
			if (li % 2 === 1) segs.reverse().forEach(g => {
				const a = g.sx;
				g.sx = g.ex;
				g.ex = a
			});
			segs.forEach(g => {
				const d = g.ex >= g.sx ? 1 : -1;
				let k = 0;
				while (k < 8) {
					const c = Math.floor((g.sx - d * (k + 1) * CS) / CS);
					if (c < 0 || c >= W) break;
					let bad = false;
					for (let r = g.ra; r <= g.rb; r++) {
						if (blk(idx(c, r))) {
							bad = true;
							break
						}
					}
					if (bad) break;
					k++
				}
				let a = g.sx - d * Math.min(0.4, Math.max(0, k - 4) * CS);
				let b = g.ex - d * 0.4;
				if ((b - a) * d < 0) b = a;
				while ((b - a) * d > 0 && BO[cellOf({
						x: a,
						y: g.y
					})] < CLR) a += d * CS;
				while ((b - a) * d > 0 && BO[cellOf({
						x: b,
						y: g.y
					})] < CLR) b -= d * CS;
				if (BO[cellOf({
						x: a,
						y: g.y
					})] < CLR || BO[cellOf({
						x: b,
						y: g.y
					})] < CLR) return;
				lanes.push({
					sx: a,
					ex: b,
					y: g.y
				});
				cover += g.cnt
			});
			li++;
			if (y >= y1 - hw - 0.01 || y >= Math.max(y0 + hw, y1 - hw) - 1e-6 && yc >=
				y1 - hw) break;
			yc += step;
		}
		return {
			lanes, cover
		}
	}

	function plan(replan) {
		if (!replan) return planAt(0).lanes;
		let best = null;
		for (let k = 0; k < 6; k++) {
			const r = planAt(k * (BW - 0.06) / 6);
			if (!best || r.cover > best.cover) best = r
		}
		return best.cover >= 3 ? best.lanes : []
	}

	function Heap() {
		const a = [];
		return {
			n: () => a.length,
			push(d, i) {
				a.push([d, i]);
				let k = a.length - 1;
				while (k > 0) {
					const p = (k - 1) >> 1;
					if (a[p][0] <= a[k][0]) break;
					[a[p], a[k]] = [a[k], a[p]];
					k = p
				}
			},
			pop() {
				const t = a[0],
					l = a.pop();
				if (a.length) {
					a[0] = l;
					let k = 0;
					for (;;) {
						let m = k;
						const x = 2 * k + 1,
							y = x + 1;
						if (x < a.length && a[x][0] < a[m][0]) m = x;
						if (y < a.length && a[y][0] < a[m][0]) m = y;
						if (m === k) break;
						[a[m], a[k]] = [a[k], a[m]];
						k = m
					}
				}
				return t
			}
		}
	}

	// ブレード幅(6セル)が1ステップで集める雪の量[m³]。進行方向に垂直な6セルを数える
	function sweep(c, r, dc, dr) {
		let v = 0;
		const k = (dc && dr) ? 0.7071 : 1;
		for (let t = -2.5; t <= 2.5; t += 1) {
			const cc = c + Math.round(-dr * t * k),
				rr = r + Math.round(dc * t * k);
			if (!inb(cc, rr)) continue;
			const i = idx(cc, rr);
			if (T[i] === 1 && IN[i] && snow[i] > 0 && snow[i] <= BH) v += snow[i]
		}
		return v * CS * CS
	}

	function dijkstra(a, b) {
		if (!B) inflate();
		const si = cellOf(a),
			gi = b ? cellOf(b) : -1;
		const sc = si % W,
			sr = (si / W) | 0,
			gc = gi >= 0 ? gi % W : 0,
			gr = gi >= 0 ? (gi / W) | 0 : 0;
		const tolS = Math.max(1, Math.min(CLR, B[si])),
			tolG = gi >= 0 ? Math.max(1, Math.min(CLR, B[gi])) : CLR;
		const okc = (c, r) => {
			const j = idx(c, r);
			if (!IN[j]) return false;
			const b = B[j];
			if (b >= CLR) return true;
			if (b >= tolS && Math.hypot(c - sc, r - sr) <= 5) return true;
			return gi >= 0 && b >= tolG && Math.hypot(c - gc, r - gr) <= 5
		};
		const aware = $('aware').checked,
			lf = Math.max(0, Math.min(1, R.load / CAP));
		const dist = new Float64Array(W * H).fill(Infinity),
			prev = new Int32Array(W * H).fill(-1),
			hp = Heap();
		dist[si] = 0;
		hp.push(0, si);
		while (hp.n()) {
			const [d, i] = hp.pop();
			if (d > dist[i]) continue;
			if (i === gi) break;
			const c = i % W,
				r = (i / W) | 0;
			for (let dr = -1; dr <= 1; dr++)
				for (let dc = -1; dc <= 1; dc++) {
					if (!dc && !dr) continue;
					const nc = c + dc,
						nr = r + dr;
					if (!inb(nc, nr)) continue;
					const j = idx(nc, nr);
					if (!okc(nc, nr)) continue;
					if (dc && dr && (!okc(c + dc, r) || !okc(c, r + dr))) continue;
					const w = ((dc && dr) ? 1.4142 : 1) * CS;
					let cost = w;
					if (B[j] < SOFT) cost += w * (SOFT - B[j]) * 0.5;
					if (BAD[j]) cost += w * 6 * BAD[j];
					// 除雪範囲は空荷でも必ず除雪して通るので、集める雪の量に応じてコストを加える(満載に近いほど重い)
					if (aware && T[j] === 1) cost += sweep(nc, nr, dc, dr) * KS * (0.05 + lf *
						1.1);
					const nd = d + cost;
					if (nd < dist[j]) {
						dist[j] = nd;
						prev[j] = i;
						hp.push(nd, j)
					}
				}
		}
		return {
			dist, prev
		}
	}

	function route(a, b, mode) {
		const gi = cellOf(b),
			res = dijkstra(a, b);
		if (!isFinite(res.dist[gi])) return null;
		const p = [];
		for (let i = gi; i >= 0; i = res.prev[i]) p.push(i);
		p.reverse();
		const out = [];
		for (let k = 1; k < p.length; k++) {
			const i = p[k],
				c = i % W,
				r = (i / W) | 0;
			if (k < p.length - 1) {
				const n = p[k + 1],
					pc = p[k - 1];
				if ((c - (pc % W)) === ((n % W) - c) && (r - ((pc / W) | 0)) === (((n / W) |
						0) - r)) continue
			}
			out.push({
				x: c * CS + CS / 2,
				y: r * CS + CS / 2,
				mode
			})
		}
		out.push({
			x: b.x,
			y: b.y,
			mode
		});
		return out
	}

	function bestDump() {
		const res = dijkstra(R, null);
		let best = null,
			bs = Infinity;
		for (let i = 0; i < T.length; i++)
			if (T[i] === 2 && IN[i] && isFinite(res.dist[i])) {
				const s = res.dist[i] + snow[i] * 6;
				if (s < bs) {
					bs = s;
					best = {
						x: (i % W) * CS + CS / 2,
						y: ((i / W) | 0) * CS + CS / 2
					}
				}
			}
		return best
	}

	// ---- 動作 ----
	function decide() {
		if (R.phase === 'dumping') {
			R.phase = 'work';
			if (R.resume) {
				const p = R.resume;
				R.resume = null;
				const rt = route(R, p, 'move');
				if (rt && R.cur) {
					R.queue = rt.concat([{
						x: R.cur.ex,
						y: R.cur.y,
						mode: 'work',
						end: true
					}]);
					return
				}
				R.cur = null
			}
		}
		if (R.needDump) {
			R.needDump = false;
			const d = bestDump();
			const rt = d ? route(R, d, 'carry') : null;
			if (!rt) {
				R.done = true;
				R.err = true;
				msg('雪置き場へ敷地内の安全な経路で到達できないため停止しました。');
				return
			}
			R.queue = rt.concat([{
				x: d.x,
				y: d.y,
				mode: 'dump'
			}]);
			R.phase = 'dumping';
			return
		}
		if (R.segs.length) {
			R.cur = R.segs.shift();
			const rt = route(R, {
				x: R.cur.sx,
				y: R.cur.y
			}, 'move');
			if (!rt) {
				R.cur = null;
				return decide()
			}
			R.queue = rt.concat([{
				x: R.cur.ex,
				y: R.cur.y,
				mode: 'work',
				end: true
			}]);
			return
		}
		if (R.replans < MAXRE && needLeft()) {
			R.replans++;
			const s = plan(true);
			if (s.length) {
				R.segs = s;
				R.plan = s.map(g => ({...g
				}));
				return decide()
			}
		}
		if (R.load > 0.001) {
			R.needDump = true;
			R.resume = null;
			return decide()
		}
		if (!R.home) {
			R.home = true;
			const rt = HOME ? route(R, HOME, 'move') : null;
			R.queue = rt || [];
			return
		}
		R.done = true
	}
	// 除雪範囲の上を走っている間は、作業・空荷・運搬のどの走行でも雪を集める
	function pickup() {
		const nx = -Math.sin(R.th),
			ny = Math.cos(R.th),
			fx = Math.cos(R.th) * 0.4,
			fy = Math.sin(R.th) * 0.4;
		for (let t = -BW / 2; t <= BW / 2; t += 0.06) {
			const c = Math.floor((R.x + fx + nx * t) / CS),
				r = Math.floor((R.y + fy + ny * t) / CS);
			if (!inb(c, r)) continue;
			const i = idx(c, r);
			if (T[i] === 1 && IN[i] && snow[i] > 0 && snow[i] <= BH && R.load + snow[i] *
				CS * CS <= CAP) {
				R.load += snow[i] * CS * CS;
				snow[i] = 0
			}
		}
	}
	// 走行中に満杯になったら、その場で雪置き場へ向かう
	function checkFull(mode) {
		if (R.load < CAP - 0.006 || R.needDump || R.phase === 'dumping' || mode ===
			'dump') return;
		if (mode === 'work' && R.cur) R.resume = {
			x: R.x,
			y: R.y
		};
		else {
			R.resume = null;
			if (mode === 'move') {
				if (R.cur) {
					R.segs.unshift(R.cur);
					R.cur = null
				} else R.home = false
			}
		}
		R.needDump = true;
		R.queue = []
	}

	function spill(dm) {
		if (R.load < CAP * 0.97) return;
		const nx = -Math.sin(R.th),
			ny = Math.cos(R.th),
			cells = new Set();
		let n = 0;
		for (let t = -BW / 2; t <= BW / 2 + 1e-9; t += CS / 2) {
			n++;
			const c = Math.floor((R.x + nx * t) / CS),
				r = Math.floor((R.y + ny * t) / CS);
			if (inb(c, r) && T[idx(c, r)] === 1 && IN[idx(c, r)] && snow[idx(c, r)] >
				0.004) cells.add(idx(c, r))
		}
		if (!cells.size) return;
		const vol = Math.min(R.load, SPILL * (R.load / CAP) * dm * cells.size / n);
		const per = vol / cells.size / (CS * CS);
		cells.forEach(i => snow[i] += per);
		R.load -= vol;
		R.spill += vol
	}

	function unload(dt) {
		const amt = Math.min(R.load, 0.05 * dt);
		const cells = [];
		const rc = Math.round(0.6 / CS);
		const c0 = Math.floor(R.x / CS),
			r0 = Math.floor(R.y / CS);
		for (let dr = -rc; dr <= rc; dr++)
			for (let dc = -rc; dc <= rc; dc++)
				if (inb(c0 + dc, r0 + dr) && T[idx(c0 + dc, r0 + dr)] === 2 && IN[idx(c0 +
						dc, r0 + dr)]) cells.push(idx(c0 + dc, r0 + dr));
		if (!cells.length) {
			R.load = 0;
			return
		}
		cells.forEach(i => snow[i] += amt / cells.length / (CS * CS));
		R.load -= amt
	}

	function inside(x, y) {
		const c = Math.floor(x / CS),
			r = Math.floor(y / CS);
		return inb(c, r) && IN[idx(c, r)] === 1
	}

	function footOK() {
		const c = Math.cos(R.th),
			s = Math.sin(R.th);
		for (const [a, b] of[[0, 0], [-.36, -.36], [-.36, .36], [.36, -.36], [.36, .36], [
				.36, 0
			], [-.36, 0], [0, -.36], [0, .36]])
			if (!inside(R.x + a * c - b * s, R.y + a * s + b * c)) return false;
		return true
	}
	// 境界を越えかけた地点とその前方を「危険」として記録し、以後の経路・レーン計画で避ける
	function markBad(x, y, th) {
		for (const [px, py] of[[x, y], [x + Math.cos(th) * 0.4, y + Math.sin(th) *
				0.4
			]]) {
			const c0 = Math.floor(px / CS),
				r0 = Math.floor(py / CS);
			for (let dr = -3; dr <= 3; dr++)
				for (let dc = -3; dc <= 3; dc++) {
					const c = c0 + dc,
						r = r0 + dr;
					if (inb(c, r) && dc * dc + dr * dr <= 9) {
						const i = idx(c, r);
						BAD[i] = Math.min(250, BAD[i] + 2)
					}
				}
		}
	}
	// 走ってきた軌跡を逆にたどって後退する
	function backUp(dm) {
		let rem = dm;
		while (rem > 0 && R.hist.length) {
			const p = R.hist[R.hist.length - 1],
				d = Math.hypot(p.x - R.x, p.y - R.y);
			if (d <= rem) {
				R.x = p.x;
				R.y = p.y;
				R.th = p.th;
				R.hist.pop();
				rem -= d;
				R.dist += d;
				R.back -= d
			} else {
				R.x += (p.x - R.x) / d * rem;
				R.y += (p.y - R.y) / d * rem;
				R.dist += rem;
				R.back -= rem;
				rem = 0
			}
		}
		if (!R.hist.length) R.back = 0
	}

	function afterBack() {
		const m = R.failMode;
		if (m === 'work') R.cur = null;
		else if (m === 'carry') {
			R.needDump = true;
			R.phase = 'work'
		} else if (m === 'move') {
			if (R.cur) {
				if ((R.cur.tries = (R.cur.tries || 0) + 1) <= 2) R.segs.unshift(R.cur);
				R.cur = null
			} else R.home = false
		}
		R.queue = []
	}

	function adv(dm, dt) {
		if (R.back > 0) {
			backUp(dm);
			if (R.back <= 0) {
				R.back = 0;
				afterBack()
			}
			return
		}
		if (!R.queue.length) {
			decide();
			if (!R.queue.length) return
		}
		const w = R.queue[0];
		if (w.mode === 'dump') {
			unload(dt);
			if (R.load <= 1e-5) {
				R.load = 0;
				R.trips++;
				R.queue.shift()
			}
			return
		}
		const ox = R.x,
			oy = R.y,
			oth = R.th,
			od = R.dist;
		const dx = w.x - R.x,
			dy = w.y - R.y,
			d = Math.hypot(dx, dy);
		let mv = 0;
		let pv = false;
		if (d > 0.02) {
			const a = Math.atan2(dy, dx);
			let da = a - R.th;
			while (da > Math.PI) da -= 2 * Math.PI;
			while (da < -Math.PI) da += 2 * Math.PI;
			if (Math.abs(da) > 0.6) pv = true;
			R.th += da * 0.35
		}
		if (pv) {} else if (d <= dm) {
			R.x = w.x;
			R.y = w.y;
			mv = d;
			R.dist += d;
			R.queue.shift();
			if (w.end) R.cur = null
		} else {
			R.x += dx / d * dm;
			R.y += dy / d * dm;
			mv = dm;
			R.dist += dm
		}
		if (!footOK()) {
			const fx = R.x,
				fy = R.y,
				fth = R.th;
			R.x = ox;
			R.y = oy;
			R.th = oth;
			R.dist = od;
			markBad(fx, fy, fth);
			R.fails++;
			R.queue = [];
			if (R.fails > FAILMAX) {
				R.done = true;
				R.err = true;
				msg('敷地内で安全に進める経路が見つからず停止しました。');
				return
			}
			R.failMode = w.mode;
			if (R.load > 1e-4) {
				afterBack();
				msg('雪を積んでいるため後退せず、その場で向きを変えて別ルートに切り替えます。');
				return
			}
			R.back = BACK;
			msg('機体が敷地の外へ出そうになったため、後退して別ルートに切り替えます。');
			return
		}
		const lp = R.hist[R.hist.length - 1];
		if (!lp || Math.hypot(lp.x - R.x, lp.y - R.y) >= 0.03) {
			R.hist.push({
				x: R.x,
				y: R.y,
				th: R.th
			});
			if (R.hist.length > 60) R.hist.shift()
		}
		if (w.mode === 'carry' && R.load > 1e-6) spill(mv);
		if (mv > 0) {
			pickup();
			checkFull(w.mode)
		}
	}

	function tick(ts) {
		if (running && !R.done) {
			const dt = Math.min(0.05, (ts - last) / 1000) * $('spd').value;
			const n = Math.max(1, Math.ceil(V0 * dt / 0.04));
			for (let k = 0; k < n; k++) {
				adv(V0 * dt / n, dt / n);
				R.t += dt / n;
				if (R.done) break
			}
			if (R.done) {
				running = false;
				$('run').textContent = '▶ 走行開始';
				stats();
				if (!R.err) msg('走行を終了しました。除雪進捗 ' + $('s_p').textContent + '(運搬中に落とした雪 ' +
					Math.round(R.spill * 1000) + ' L、再除雪の計画 ' + R.replans + ' 回、後退 ' + R.fails +
					' 回)。境界付近は安全のため一部を除雪しない場合があります。')
			}
			stats()
		}
		last = ts;
		draw();
		requestAnimationFrame(tick)
	}

	function start() {
		if (R.done) reset();
		if (!R.started) {
			if (!closed) {
				msg('敷地の境界が未設定です。「敷地境界(線)」で角を順にクリックして囲んでください。');
				return
			}
			if (hd) {
				B = null;
				setHome();
				hd = false;
				R.x = HOME ? HOME.x : R.x;
				R.y = HOME ? HOME.y : R.y;
				R.hist = [{
					x: R.x,
					y: R.y,
					th: R.th
				}]
			}
			if (!HOME) {
				msg('敷地内に機体が置ける場所がありません。敷地を広げてください。');
				return
			}
			countZone();
			let hasZ = false,
				hasD = false;
			for (let i = 0; i < T.length; i++) {
				if (T[i] === 1 && IN[i]) hasZ = true;
				if (T[i] === 2 && IN[i]) hasD = true
			}
			if (!hasZ) {
				msg('敷地内に除雪範囲がありません。「除雪範囲」で敷地内を塗ってください。');
				return
			}
			if (!hasD) {
				msg('敷地内に雪置き場がありません。「雪置き場」で敷地内を塗ってください。');
				return
			}
			inflate();
			R.segs = plan();
			R.plan = R.segs.map(s => ({...s
			}));
			R.started = true;
			if (!R.segs.length) {
				msg('走行できるレーンがありません(範囲が狭すぎるか、境界・障害物で塞がれています)。');
				R.started = false;
				return
			}
			msg('走行レーン数: ' + R.segs.length)
		}
		running = !running;
		$('run').textContent = running ? '⏸ 一時停止' : '▶ 再開'
	}

	// ---- 描画 ----
	function draw() {
		if (hd && R && !R.started) {
			B = null;
			setHome();
			hd = false;
			if (HOME) {
				R.x = HOME.x;
				R.y = HOME.y;
				R.hist = [{
					x: R.x,
					y: R.y,
					th: R.th
				}]
			}
		}
		const cols = ['#cdd4da', '#7d8892', '#c9a063', '#4a545e'];
		for (let r = 0; r < H; r++)
			for (let c = 0; c < W; c++) {
				const i = idx(c, r),
					t = T[i];
				ctx.fillStyle = cols[t];
				ctx.fillRect(c * PX, r * PX, PX, PX);
				const s = snow[i];
				if (s > 0.004) {
					const over = s > BH;
					ctx.fillStyle = over ? 'rgba(255,120,120,.85)' : 'rgba(255,255,255,' +
						Math.min(1, 0.4 + s * 1.6).toFixed(2) + ')';
					ctx.fillRect(c * PX, r * PX, PX, PX)
				}
				if (closed && !IN[i]) {
					ctx.fillStyle = 'rgba(20,25,30,.5)';
					ctx.fillRect(c * PX, r * PX, PX, PX)
				}
			}
		const m = PX / CS;
		if (R.plan.length) {
			ctx.strokeStyle = 'rgba(30,110,200,.55)';
			ctx.setLineDash([4, 3]);
			ctx.lineWidth = 1;
			R.plan.forEach(s => {
				ctx.beginPath();
				ctx.moveTo(s.sx * m, s.y * m);
				ctx.lineTo(s.ex * m, s.y * m);
				ctx.stroke()
			});
			ctx.setLineDash([])
		}
		if (R.queue.length) {
			let px = R.x,
				py = R.y;
			ctx.lineWidth = 2;
			ctx.setLineDash([]);
			for (const w of R.queue) {
				if (w.mode === 'dump' || w.mode === 'work') break;
				ctx.strokeStyle = w.mode === 'carry' ? 'rgba(232,112,10,.9)' :
					'rgba(42,143,74,.9)';
				ctx.beginPath();
				ctx.moveTo(px * m, py * m);
				ctx.lineTo(w.x * m, w.y * m);
				ctx.stroke();
				px = w.x;
				py = w.y
			}
		}
		if (BP.length) {
			ctx.strokeStyle = '#d11a5a';
			ctx.fillStyle = '#d11a5a';
			ctx.lineWidth = 2.5;
			ctx.setLineDash([]);
			ctx.beginPath();
			BP.forEach((p, k) => k ? ctx.lineTo(p.x * m, p.y * m) : ctx.moveTo(p.x * m,
				p.y * m));
			if (closed) ctx.closePath();
			ctx.stroke();
			BP.forEach(p => {
				ctx.beginPath();
				ctx.arc(p.x * m, p.y * m, 3.5, 0, 7);
				ctx.fill()
			})
		}
		if (HOME) {
			ctx.fillStyle = '#2a8f4a';
			ctx.font = '11px sans-serif';
			ctx.fillText('H', HOME.x * m - 3, HOME.y * m - 14)
		}
		ctx.save();
		ctx.translate(R.x * m, R.y * m);
		ctx.rotate(R.th);
		ctx.fillStyle = '#e8700a';
		ctx.fillRect(-0.36 * m, -0.36 * m, 0.72 * m, 0.72 * m);
		ctx.fillStyle = '#222';
		ctx.fillRect(-0.3 * m, -0.36 * m, 0.6 * m, 0.08 * m);
		ctx.fillRect(-0.3 * m, 0.28 * m, 0.6 * m, 0.08 * m);
		ctx.fillStyle = '#f2f2f2';
		ctx.strokeStyle = '#333';
		ctx.lineWidth = 1;
		ctx.fillRect(0.3 * m, -BW / 2 * m, 0.06 * m, BW * m);
		ctx.strokeRect(0.3 * m, -BW / 2 * m, 0.06 * m, BW * m);
		ctx.restore();
		ctx.fillStyle = 'rgba(0,0,0,.45)';
		ctx.fillRect(R.x * m - 14, R.y * m - 0.5 * m - 8, 28, 5);
		ctx.fillStyle = '#fff';
		ctx.fillRect(R.x * m - 14, R.y * m - 0.5 * m - 8, 28 * Math.min(1, R.load /
			CAP), 5)
	}

	function stats() {
		let rem = 0,
			rv = 0;
		for (let i = 0; i < T.length; i++)
			if (needCell(i)) {
				rem++;
				rv += snow[i] * CS * CS
			}
		const p = zone0 ? Math.round((1 - rem / zone0) * 100) : 0;
		$('s_p').textContent = p + '%';
		$('pg').style.width = p + '%';
		const t = Math.floor(R.t);
		$('s_t').textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2,
			'0');
		$('s_l').textContent = Math.round(R.load * 1000) + ' L (' + (R.load * KG).toFixed(
			1) + ' kg)';
		$('s_n').textContent = R.trips;
		$('s_d').textContent = R.dist.toFixed(0) + ' m';
		$('s_a').textContent = Math.round(R.spill * 1000) + ' L';
		$('s_m').textContent = Math.round(rv * 1000) + ' L';
		$('s_z').textContent = (zone0 * CS * CS).toFixed(1) + ' m² / ' + Math.round(
			total0 * CS * CS * 1000) + ' L';
		$('s_r').textContent = R.replans + ' 回';
		$('s_b').textContent = R.fails + ' 回'
	}

	// ---- マップ編集 ----
	let drawing = false;

	function paint(e) {
		const rc = cv.getBoundingClientRect(),
			c0 = Math.floor((e.clientX - rc.left) / rc.width * W),
			r0 = Math.floor((e.clientY - rc.top) / rc.height * H);
		const b = +$('brush').value - 1;
		for (let dr = -b; dr <= b; dr++)
			for (let dc = -b; dc <= b; dc++) {
				const c = c0 + dc,
					r = r0 + dr;
				if (inb(c, r)) {
					const i = idx(c, r);
					if (T[i] !== tool) {
						set(c, r, tool)
					}
				}
			}
		B = null;
		hd = true;
		countZone()
	}
	cv.addEventListener('pointerdown', e => {
		if (R.started) return msgLock();
		if (tool === 4) {
			addVertex(e);
			return
		}
		drawing = true;
		cv.setPointerCapture(e.pointerId);
		paint(e)
	});
	cv.addEventListener('pointermove', e => {
		if (drawing) paint(e)
	});
	cv.addEventListener('pointerup', () => {
		drawing = false
	});
	cv.addEventListener('dblclick', () => {
		if (tool === 4 && !closed && !R.started) {
			if (BP.length > 3) BP.pop();
			closeB()
		}
	});

	function msgLock() {
		msg('走行中・走行後はマップを編集できません。「リセット」を押してください。')
	}
	document.querySelectorAll('#tools button[data-t]').forEach(b => b.onclick = () => {
		document.querySelectorAll('#tools button[data-t]').forEach(x => x.classList
			.remove('on'));
		b.classList.add('on');
		tool = +b.dataset.t;
		if (tool === 4) msg('敷地の角を順にクリックして線を引き、最初の点の近くをクリック(またはダブルクリック)で閉じます。')
	});
	$('bclose').onclick = () => {
		if (R.started) return msgLock();
		if (!closed) closeB()
	};
	$('bclr').onclick = () => {
		if (R.started) return msgLock();
		clearB();
		msg('敷地境界を消しました。')
	};
	$('run').onclick = start;
	$('rst').onclick = () => {
		for (let i = 0; i < T.length; i++)
			if (T[i] === 1) snow[i] = rnd();
			else if (T[i] === 2) snow[i] = 0;
		B = null;
		reset()
	};
	$('smp').onclick = sample;
	$('clr').onclick = () => {
		T.fill(0);
		snow.fill(0);
		BP = [];
		closed = false;
		IN.fill(0);
		B = null;
		reset()
	};
	$('spd').oninput = () => {
		$('spdv').textContent = $('spd').value + 'x'
	};
	$('depth').oninput = () => {
		$('depv').textContent = $('depth').value + ' cm';
		if (R.started) return msgLock();
		for (let i = 0; i < T.length; i++)
			if (T[i] === 1) snow[i] = rnd();
		B = null;
		reset()
	};
	sample();
	requestAnimationFrame(tick);
})();
