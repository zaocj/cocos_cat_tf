import { spawn } from 'node:child_process';
import { access, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const editor = process.env.COCOS_EDITOR || '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator';
try { await access(editor); }
catch { console.error('找不到 Cocos Creator 3.8.8。请通过 COCOS_EDITOR 指定编辑器可执行文件。'); process.exit(1); }
const sceneMeta = JSON.parse(await readFile(path.join(root, 'assets/Boot.scene.meta'), 'utf8'));
await mkdir(path.join(root, '.mvp'), { recursive: true });
const logPath = path.join(root, '.mvp/build.log');
const log = await open(logPath, 'w');
const configPath = path.join(root, '.mvp/build-config.json');
await writeFile(configPath, JSON.stringify({
    platform: 'web-mobile', debug: true, md5Cache: true, name: '萌宠变异录', startScene: sceneMeta.uuid,
    packages: { 'web-mobile': { orientation: 'portrait' } },
}, null, 2));
const options = `configPath=${configPath}`;
console.log('正在使用 Cocos Creator 构建 Web MVP，完整日志：' + logPath);
const child = spawn(editor, ['--project', root, '--build', options], { stdio: ['ignore', log.fd, log.fd] });
child.on('error', async error => { await log.close(); console.error(error.message); process.exitCode = 1; });
child.on('exit', async code => {
    await log.close();
    // Cocos Creator's documented successful build exit code is 36, not 0.
    if (code === 36) {
        try { await access(path.join(root, 'build/web-mobile/index.html')); }
        catch { console.error('编辑器返回成功，但缺少构建入口。请检查日志。'); process.exitCode = 1; return; }
        console.log('构建成功：build/web-mobile。运行 npm run serve 打开本地游戏。');
    } else {
        console.error(`构建失败，退出码 ${code}；请查看 ${logPath}`); process.exitCode = 1;
    }
});
