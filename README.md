# IPI Profile Sheet

Pembaca data **in-place inclinometer (IPI)** berbasis web. Unggah file `.dat`
keluaran datalogger Campbell Scientific (format TOA5), lalu baca grafik
**cumulative displacement** dan **incremental displacement** langsung di
peramban.

Aplikasi ini sengaja dibuat ringan: tanpa framework, tanpa pustaka grafik, tanpa
animasi, dan tanpa server. Seluruh perhitungan berjalan di peramban — file tidak
pernah dikirim ke mana pun.

## Fitur

- **Unggah banyak file.** File digabung berdasarkan `TIMESTAMP`, jadi saat data
  bertambah tiap jam Anda cukup mengunggah file terbarunya. Baris yang sama
  ditimpa oleh file yang lebih baru, urutan waktu dirapikan otomatis.
- **Panjang tiap sensor (gauge length)** dapat diatur 1 m, 2 m, 3 m, atau nilai
  bebas lainnya.
- **Base reading** dapat dipilih dari pembacaan mana pun. Base reading adalah
  garis nol di kedua grafik.
- **Sumbu X dapat diatur** secara terpisah untuk grafik cumulative dan
  incremental: nilai minimum, maksimum, dan interval garis bantu. Sumbu
  kedalaman juga bisa dibatasi.
- Sumbu **A**, **B**, atau keduanya; tanda tiap sumbu bisa dibalik.
- Titik jepit dapat dipilih di **dasar** atau **kepala** lubang, dan urutan
  penomoran sensor bisa dibalik jika sensor 1 berada di bawah.
- Sampai lima **profil riwayat** digambar di belakang pembacaan terkini, dengan
  jarak merata atau per 1/7/30/90 hari.
- Grafik **riwayat waktu** pada satu kedalaman, memakai seluruh pembacaan.
- **Tabel hasil** dan ekspor **CSV** untuk profil maupun riwayat waktu.
- Data terakhir disimpan di peramban (IndexedDB), jadi halaman bisa dibuka
  kembali tanpa mengunggah ulang.

## Format data yang dibaca

File TOA5 dengan kolom berindeks, misalnya:

```
"TOA5","ID0000482_Stn08","CR300",...
"TIMESTAMP","RECORD","batt_volt","Int_Temp","Tilt_A(1,1)",...,"IPI_Temp(1,22)"
"TS","RN","","","SIN_Angle",...
"","","Smp","Smp","Smp",...
"2025-07-27 15:00:00",1,13.41,34.87,0.017078,...
```

Kolom yang dipakai, sesuai urutan prioritas:

| Kolom | Isi | Perlakuan |
|---|---|---|
| `Tilt_A(1,n)` / `Tilt_B(1,n)` | sin θ | dipakai langsung |
| `IPI_Def_A(1,n)` | defleksi (mm) | dibagi gauge logger (3000 mm) |
| `ArcDeg_A(1,n)` | sudut | dianggap radian |

`IPI_Temp(1,n)` dipakai untuk kolom suhu pada tabel. Nilai `NAN` dianggap
rumpang: segmen tersebut dihitung nol pada penjumlahan cumulative dan jumlah
sensor rumpang ditampilkan pada baris ringkasan.

Catatan: pada program logger yang diuji, kolom `ArcDeg_*` diberi satuan
`Degrees` tetapi isinya sebenarnya **radian**, dan `IPI_Def_*` dihitung dengan
gauge tetap **3000 mm**. Karena itu aplikasi selalu mengutamakan kolom `Tilt_*`
yang tidak bergantung pada asumsi panjang sensor.

## Cara hitung

Sensor melaporkan sin θ terhadap vertikal. Untuk panjang segmen `L`:

```
defleksi segmen        d(t)   = L · sin θ(t)
incremental displacement Δd   = L · ( sin θ(t) − sin θ(base) )
cumulative displacement  D(z) = Σ Δd  dari titik jepit sampai z
```

Dengan titik jepit di dasar lubang, cumulative displacement bernilai nol di
ujung bawah string dan dijumlahkan ke atas. Bila titik jepit dipilih di kepala
lubang, penjumlahan berjalan sebaliknya.

Incremental digambar di **tengah** segmen; cumulative digambar di **batas antar
segmen**, sehingga satu string dengan `n` sensor menghasilkan `n` titik
incremental dan `n + 1` titik cumulative.

## Menjalankan

Buka `index.html` langsung di peramban — tidak ada proses build dan tidak perlu
server. Untuk dipasang di hosting statis (misalnya GitHub Pages), unggah seluruh
isi repositori apa adanya.

```
index.html          kerangka halaman
assets/parser.js    pembaca TOA5/CSV dan penggabung file
assets/compute.js   perhitungan displacement
assets/chart.js     penggambar SVG (profil dan riwayat waktu)
assets/app.js       kontrol, status, dan render
assets/styles.css   token warna dan tata letak
tools/build_artifact.py  menyiapkan berkas untuk publikasi sebagai Artifact
```

## Deploy

Setiap push ke `main` dideploy ke GitHub Pages oleh
`.github/workflows/pages.yml`. Agar berjalan, Settings → Pages → Source harus
disetel ke **GitHub Actions**. Yang diunggah hanya `index.html`, `.nojekyll`,
dan folder `assets/`, sehingga `tools/` dan `README.md` tetap ada di
repositori tetapi tidak disajikan sebagai halaman.

Berbeda dengan mode "Deploy from a branch", cara ini meninggalkan catatan run
di tab Actions, jadi saat situs tidak muncul penyebabnya bisa dibaca.

`tools/build_artifact.py` menyalin bagian bertanda `<!--#head-->` dan
`<!--#body-->` dari `index.html` ke `dist/artifact.html`, yaitu bentuk tanpa
pembungkus dokumen yang dibutuhkan saat halaman dipublikasikan sebagai Artifact.
Jalur berkas tidak diubah, jadi sumber yang sama dipakai untuk ketiga cara
pemasangan.

## Warna dan aksesibilitas

Profil terkini memakai warna oranye, profil riwayat memakai tangga biru dari
yang paling lama (paling muda) ke yang paling baru. Palet diuji terhadap
pemisahan buta warna dan kontras terhadap latar, untuk mode terang maupun gelap.
Setiap grafik punya crosshair dan tooltip yang juga bisa dijalankan dari papan
ketik (Tab ke grafik, lalu panah atas/bawah), serta tabel nilai sebagai
padanannya.
