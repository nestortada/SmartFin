// 6B.3: what es-CO/COP Intl prints for small amounts under the current and proposed options.
const format = options => new Intl.NumberFormat('es-CO', { currency: 'COP', style: 'currency', ...options });
for (const value of [0.4, -0.4, 0.01, 0.6, 0.004, 1234.5, 0]) {
  console.log(value, JSON.stringify({
    current: format({ maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(value),
    defaultMax: format({ minimumFractionDigits: 0 }).format(value),
    twoDecimals: format({ maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value),
  }));
}
