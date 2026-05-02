/**
 * 临时脚本：从网易云歌单中按顺序截取前 n 首，创建为新歌单。
 * 用法：npx tsx scripts/slice-playlist.ts <用户名> <歌单链接或ID> <截取数量> [新歌单名称]
 */
import "dotenv/config";
import { prisma } from "../src/db";
import { decryptCookie } from "../src/utils";
import { resolvePlaylistId } from "../src/utils";
import { NeteaseProvider } from "../src/provider/netease";

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    process.stdout.write(
      "用法: npx tsx scripts/slice-playlist.ts <用户名> <歌单链接或ID> <截取数量> [新歌单名称]\n"
    );
    process.exit(1);
  }

  const username = args[0];
  const playlistInput = args[1];
  const count = parseInt(args[2], 10);
  const customName = args[3] || null;

  if (Number.isNaN(count) || count <= 0) {
    process.stderr.write("截取数量必须是正整数\n");
    process.exit(1);
  }

  // 1. 查找用户并解密 cookie
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    process.stderr.write(`用户 "${username}" 不存在\n`);
    process.exit(1);
  }
  if (!user.cookie) {
    process.stderr.write(`用户 "${username}" 未绑定网易云\n`);
    process.exit(1);
  }

  const cookie = decryptCookie(user.cookie);
  const provider = new NeteaseProvider(cookie);

  // 2. 解析歌单 ID
  const resolved = await resolvePlaylistId(playlistInput);
  if (!resolved.success) {
    process.stderr.write(`歌单链接解析失败: ${resolved.error!.message}\n`);
    process.exit(1);
  }
  const playlistId = resolved.id!;

  // 3. 获取歌单元数据
  const meta = await provider.fetchPlaylistMeta(playlistId);
  process.stdout.write(`源歌单: ${meta.name} (共 ${meta.trackCount} 首)\n`);

  // 4. 抓取歌曲（保持原始顺序）
  const allTracks = await provider.fetchPlaylistTracks(playlistId);
  const sliced = allTracks.slice(0, count);
  process.stdout.write(`截取前 ${sliced.length} 首\n`);

  if (sliced.length === 0) {
    process.stderr.write("歌单为空，无法创建\n");
    process.exit(1);
  }

  // 5. 创建新歌单
  const newName = customName || `${meta.name} (前${sliced.length}首)`;
  const trackIds = sliced.map((t) => t.id);
  const url = await provider.createPlaylist(newName, trackIds);

  process.stdout.write(`新歌单已创建: ${url}\n`);
  await prisma.$disconnect();
}

main().catch((err) => {
  process.stderr.write(`错误: ${err instanceof Error ? err.message : err}\n`);
  prisma.$disconnect();
  process.exit(1);
});
