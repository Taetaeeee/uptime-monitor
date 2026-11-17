import { readFile, statfs } from 'node:fs/promises';

async function numberFile(path) {
  try {
    const value = (await readFile(path, 'utf8')).trim();
    return /^\d+$/.test(value) ? Number(value) : null;
  } catch { return null; }
}

export async function collectMetrics() {
  // 프로세스 CPU 누적값과 RSS는 호스트 전체 CPU%·메모리%가 아닙니다.
  const cpu = process.cpuUsage();
  let filesystem = null;
  try {
    const fs = await statfs('/app');
    filesystem = { available_bytes: fs.bavail * fs.bsize, total_bytes: fs.blocks * fs.bsize,
      scope: 'container_filesystem_shared_backing' };
  } catch { /* 읽을 수 없는 값은 0으로 채우지 않습니다. */ }
  let network = null;
  try {
    network = (await readFile('/proc/net/dev', 'utf8')).split('\n').slice(2)
      .filter(line => line.includes(':') && !line.trim().startsWith('lo:'))
      .map(line => {
        const [name, raw] = line.split(':');
        const v = raw.trim().split(/\s+/).map(Number);
        return { interface: name.trim(), rx_bytes_total: v[0], tx_bytes_total: v[8],
          rx_errors_total: v[2], tx_errors_total: v[10] };
      });
  } catch { /* Linux 컨테이너 외 환경은 미지원으로 남깁니다. */ }
  return {
    scope: 'erp_container',
    process_cpu_seconds_total: (cpu.user + cpu.system) / 1e6,
    process_rss_bytes: process.memoryUsage().rss,
    container_memory_current_bytes: await numberFile('/sys/fs/cgroup/memory.current'),
    container_memory_limit_bytes: await numberFile('/sys/fs/cgroup/memory.max'),
    filesystem, network,
  };
}
