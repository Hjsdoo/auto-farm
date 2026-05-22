/**
 * Probe 1.11.3.11_YYYYMMDD for each day in [start, end].
 * Usage: node scripts/probe-version-range.js [start=20260313] [end=20260517]
 */
const WebSocket = require('ws');
const fs = require('node:fs');
const path = require('node:path');
const { loadProto, types } = require('../src/utils/proto');
const { toLong, toNum } = require('../src/utils/utils');

const accounts = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/accounts.json'), 'utf8'));
const account = accounts.accounts && accounts.accounts[0];
const code = account && account.code;
const platform = (account && account.platform) || 'wx';
const os = 'iOS';
const serverUrl = 'wss://gate-obt.nqf.qq.com/prod/ws';

function parseYmd(s) {
    const n = Number(s);
    if (!Number.isFinite(n) || n < 20000101) return null;
    const y = Math.floor(n / 10000);
    const m = Math.floor((n % 10000) / 100);
    const d = n % 100;
    return new Date(Date.UTC(y, m - 1, d));
}

function formatYmd(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}`;
}

function* dateRange(startYmd, endYmd) {
    const start = parseYmd(startYmd);
    const end = parseYmd(endYmd);
    if (!start || !end || start > end) return;
    const cur = new Date(start);
    while (cur <= end) {
        yield formatYmd(cur);
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
}

function sendLogin(ws, ver) {
    const body = types.LoginRequest.encode(types.LoginRequest.create({
        sharer_id: toLong(0),
        sharer_open_id: '',
        device_info: {
            client_version: ver,
            sys_software: 'iOS 26.2.1',
            network: 'wifi',
            memory: '7672',
            device_id: 'iPhone X<iPhone18,3>',
        },
        share_cfg_id: toLong(0),
        scene_id: '1256',
    })).finish();
    const meta = types.GateMeta.create({
        service_name: 'gamepb.userpb.UserService',
        method_name: 'Login',
        message_type: 1,
        client_seq: 1,
    });
    ws.send(types.GateMessage.encode(types.GateMessage.create({ meta, body })).finish());
}

function handleMessage(buf, state) {
    try {
        const msg = types.GateMessage.decode(buf);
        const meta = msg.meta || {};
        const msgType = toNum(meta.message_type);
        if (msgType === 3 && msg.body) {
            const event = types.EventMessage.decode(msg.body);
            if ((event.message_type || '').includes('Kickout') && event.body) {
                const notify = types.KickoutNotify.decode(event.body);
                state.kick = notify.reason_message || 'Kickout';
                return;
            }
        }
        if (msgType === 2 && meta.method_name === 'Login' && toNum(meta.error_code) === 0 && msg.body) {
            try {
                const reply = types.LoginReply.decode(msg.body);
                state.login = true;
                state.name = reply.basic && reply.basic.name ? reply.basic.name : '';
            } catch {
                state.login = true;
            }
        } else if (msgType === 2 && toNum(meta.error_code) !== 0) {
            state.error = `${meta.method_name} code=${toNum(meta.error_code)} ${meta.error_message || ''}`;
        }
    } catch {}
}

function probe(ver, plat) {
    return new Promise((resolve) => {
        const url = `${serverUrl}?platform=${encodeURIComponent(plat)}&os=${encodeURIComponent(os)}&ver=${encodeURIComponent(ver)}&code=${encodeURIComponent(code)}&openID=`;
        const ws = new WebSocket(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 MicroMessenger/7.0.20.1781 MiniProgramEnv/Windows',
                Origin: 'https://gate-obt.nqf.qq.com',
            },
        });
        const state = {};
        let settled = false;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { ws.terminate(); } catch {}
            resolve(result);
        };
        const timer = setTimeout(() => {
            if (state.login) finish({ status: 'login', name: state.name });
            else if (state.kick) finish({ status: 'kick', msg: state.kick });
            else if (state.error) finish({ status: 'error', msg: state.error });
            else finish({ status: 'timeout' });
        }, 3500);
        ws.on('open', () => sendLogin(ws, ver));
        ws.on('message', (data) => {
            handleMessage(Buffer.isBuffer(data) ? data : Buffer.from(data), state);
            if (state.kick) finish({ status: 'kick', msg: state.kick });
            if (state.login) finish({ status: 'login', name: state.name });
            if (state.error) finish({ status: 'error', msg: state.error });
        });
        ws.on('error', (e) => finish({ status: 'ws400', msg: e.message }));
        ws.on('close', (c) => {
            if (!settled) finish({ status: 'closed', code: c });
        });
    });
}

(async () => {
    if (!code) {
        console.error('No code in accounts.json');
        process.exit(1);
    }
    const start = process.argv[2] || '20260313';
    const end = process.argv[3] || '20260517';
    await loadProto();

    const summary = { login: [], kick: [], ws400: [], other: [] };
    console.log(`platform=${platform}  ver=1.11.3.11_${start} .. 1.11.3.11_${end}\n`);

    for (const ymd of dateRange(start, end)) {
        const ver = `1.11.3.11_${ymd}`;
        const r = await probe(ver, platform);
        let label;
        if (r.status === 'login') {
            label = `LOGIN OK${r.name ? ` (${r.name})` : ''}`;
            summary.login.push(ymd);
        } else if (r.status === 'kick') {
            label = `KICK: ${r.msg}`;
            summary.kick.push(ymd);
        } else if (r.status === 'ws400') {
            label = `WS 400`;
            summary.ws400.push(ymd);
        } else {
            label = `${r.status}${r.msg ? `: ${r.msg}` : ''}${r.code !== undefined ? ` (${r.code})` : ''}`;
            summary.other.push({ ymd, label });
        }
        console.log(`${ver}  ${label}`);
        await new Promise((r) => setTimeout(r, 150));
    }

    console.log('\n--- 汇总 ---');
    console.log(`登录成功: ${summary.login.length} 天`, summary.login.join(', ') || '(无)');
    console.log(`版本过低踢下线: ${summary.kick.length} 天`);
    console.log(`握手 400: ${summary.ws400.length} 天`, summary.ws400.length ? `(${summary.ws400[0]}..${summary.ws400[summary.ws400.length - 1]})` : '');
    if (summary.other.length) console.log(`其他: ${summary.other.length}`);
})();
