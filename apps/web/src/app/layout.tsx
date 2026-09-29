import type { Metadata, Viewport } from "next";
import "@fontsource/satisfy";
import "./globals.css";

export const metadata: Metadata = {
  title: "Plandit",
  description: "개인 일정부터 팀 일정까지 한 곳에서. 리마인더 발송과 크레딧 과금을 지원하는 캘린더 워크스페이스.",
};

// viewport-fit=cover lets the tab bar pad itself with env(safe-area-inset-bottom) on notched phones.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0c" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        {/* Pretendard with Korean glyphs, split by unicode range so a page only downloads the characters it shows. */}
        <link crossOrigin="anonymous" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" rel="stylesheet" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('plandit-theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}})()`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
