import Document, {
  Html,
  Head,
  Main,
  NextScript,
  type DocumentContext,
  type DocumentInitialProps,
} from "next/document";

interface MyDocumentProps extends DocumentInitialProps {
  nonce?: string;
}

export default class MyDocument extends Document<MyDocumentProps> {
  static async getInitialProps(
    ctx: DocumentContext,
  ): Promise<MyDocumentProps> {
    const initialProps = await Document.getInitialProps(ctx);
    const nonceHeader = ctx.req?.headers["x-nonce"];
    const nonce = Array.isArray(nonceHeader) ? nonceHeader[0] : nonceHeader;

    return {
      ...initialProps,
      nonce,
    };
  }

  render() {
    const nonce = (this.props as MyDocumentProps).nonce;

    return (
      <Html lang="en">
        <Head />
        <body>
          <Main />
          <NextScript nonce={nonce} />
        </body>
      </Html>
    );
  }
}
