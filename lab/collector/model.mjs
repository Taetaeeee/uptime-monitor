// 변화율은 앞뒤 실측값으로 계산합니다. 재시작·결측 때는 null로 남깁니다.
export function rates(previous, current) {
  if (!previous || !current || previous.instance_id !== current.instance_id) return null;
  const seconds = (Date.parse(current.observed_at) - Date.parse(previous.observed_at)) / 1000;
  if (!(seconds > 0)) return null;
  const before = previous.metrics;
  const now = current.metrics;
  const cpu = now.process_cpu_seconds_total - before.process_cpu_seconds_total;
  return {
    window_seconds: seconds,
    process_cpu_percent_one_core: cpu >= 0 ? cpu / seconds * 100 : null,
    network: now.network?.map(row => {
      const old = before.network?.find(item => item.interface === row.interface);
      const rx = old ? row.rx_bytes_total - old.rx_bytes_total : -1;
      const tx = old ? row.tx_bytes_total - old.tx_bytes_total : -1;
      return { interface: row.interface, rx_bytes_per_second: rx >= 0 ? rx / seconds : null,
        tx_bytes_per_second: tx >= 0 ? tx / seconds : null };
    }) ?? null,
  };
}

export function isFresh(snapshot, now = Date.now()) {
  const age = now - Date.parse(snapshot?.received_at);
  return Number.isFinite(age) && age >= 0 && age <= 60000;
}
