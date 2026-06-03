import App from "./App.jsx";
import DisplayApp from "./DisplayApp.jsx";

function Root() {
  return window.location.pathname.startsWith("/display/") ? <DisplayApp /> : <App />;
}

export default Root;
