import "./globals.css";

export const metadata = {
  title: "일정 취합 사이트",
  description: "여러 사람의 가능한 시간을 모아 한눈에 보는 일정 취합 도구",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>
        {children}
        <div id="toast" />
      </body>
    </html>
  );
}
