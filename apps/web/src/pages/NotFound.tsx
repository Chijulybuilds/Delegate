import { Link } from 'react-router';
import { Button, Logo } from '../components/ui';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col px-5 py-6 sm:px-10">
      <Link to="/" className="self-start">
        <Logo />
      </Link>
      <div className="m-auto text-center">
        <p className="text-sm text-faint">404</p>
        <h1 className="mt-2 text-[clamp(2.2rem,5vw,3.4rem)] font-medium leading-[1] tracking-display">
          <span className="text-ink-soft">This ticket</span> doesn’t exist.
        </h1>
        <Link to="/" className="mt-8 inline-block">
          <Button>Back to home</Button>
        </Link>
      </div>
    </div>
  );
}
