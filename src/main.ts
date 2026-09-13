import { bootstrap } from "./bootstrap";
import { renderBootError } from "./boot-error";
import "./styles.css";

void bootstrap().catch(renderBootError);
