import Navbar from "../components/Navbar";
import "./globals.css";

export const metadata = { title: "ManyTools" };

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>
        <div className="app">
          <Navbar />
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
