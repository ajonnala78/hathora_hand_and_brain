import { Methods, Context } from "./.hathora/methods";
import { Response } from "../api/base";
import {
  UserId,
  GameStatus,
  Color,
  Role,
  Piece,
  PlayerState,
  IJoinGameRequest,
  IStartGameRequest,
  IPickPieceRequest,
  IMovePieceRequest,
  PieceType,
} from "../api/types";
import { Chess, ChessInstance, Piece as ChessPiece, Square, Move } from "chess.js";

type InternalUser = {
  name: UserId;
  color: Color;
  role: Role;
};
type InternalState = {
  chess: ChessInstance;
  users: InternalUser[];
  turnCount: number;
  moveablePiece?: PieceType;
};

export class Impl implements Methods<InternalState> {
  initialize(userId: UserId, ctx: Context): InternalState {
    return { chess: new Chess(), users: [], turnCount: 0};
  }
  joinGame(state: InternalState, userId: UserId, ctx: Context, request: IJoinGameRequest): Response {
    if (state.users.find((u) => u.name === userId) !== undefined){
      return Response.error("You have already joined the game!");
    }
    if (state.users.length == 0){
       state.users.push({name : userId, color: Color.WHITE, role: Role.HAND});
    } else if (state.users.length == 1){
      state.users.push({name: userId, color: Color.BLACK, role: Role.HAND});
   } else if (state.users.length == 2){
      state.users.push({name: userId, color: Color.WHITE, role: Role.BRAIN});
   } else if (state.users.length == 3){
      state.users.push({name: userId, color: Color.BLACK, role: Role.BRAIN});
   }else {
      return Response.error("There are already 4 players in this game!");
   }
   return Response.ok();
  }
  startGame(state: InternalState, userId: UserId, ctx: Context, request: IStartGameRequest): Response {
    if (state.users.length != 4){
      return Response.error("4 players are needed to start the game, game will automatically start once 4 have joined!");
    }
    return Response.ok();
  }
  pickPiece(state: InternalState, userId: UserId, ctx: Context, request: IPickPieceRequest): Response{
    if (!isUserInGame(userId, state)){
      return Response.error("You are not in this game, click JoinGame to enter.");
    }
    if (gameStatus(state) === GameStatus.WAITING){
      return Response.error("Game not started, wait till 4 people have joined.");
    }
    if (!isUserTurn(userId, state)){
      return Response.error("Not your turn!");
    }

    const user = state.users.find((u) => u.name === userId);
    if (user?.role !== Role.BRAIN){
      return Response.error("You are not the brain, you cannot pick a piece!");
    }

    if (state.moveablePiece !== undefined) {
     return Response.error("You already picked a piece, you cannot change it!");
    }

    const pickedPiece = request.piece as PieceType;
    if (pickedPiece === undefined){
      return Response.error("You did not pick a valid piece, pick one of PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING");
    }

    if (!isPieceMoveable(pickedPiece,state)){
      return Response.error("This piece does not have a legal move, pick another one!");
    }

    state.moveablePiece = pickedPiece;
    return Response.ok();
  }
  movePiece(state: InternalState, userId: UserId, ctx: Context, request: IMovePieceRequest): Response {
    if (!isUserInGame(userId, state)){
      return Response.error("You are not in this game, click JoinGame to enter.");
    }
    if (gameStatus(state) === GameStatus.WAITING) {
      return Response.error("Game not started, wait till 4 people have joined.");
    }
    if (!isUserTurn(userId, state)){
      return Response.error("Not your turn!");
    }

    const user = state.users.find((u) => u.name === userId);
    if (user?.role !== Role.HAND){
     return Response.error("Only the hand can move a piece!");
    }
    if (state.moveablePiece === undefined) {
      return Response.error("Brain has not picked a moveable piece yet!");
    }

    const fromSquare = request.from as Square;
    if (fromSquare === undefined){
     return Response.error("from square not found!");
    }
    const movePiece = state.chess.get(fromSquare);
    if (movePiece === null || (convertType(movePiece.type) !== state.moveablePiece)){
      return Response.error("You cannot move this piece!");
    }

    const move = state.chess.move({ from: request.from as Square, to: request.to as Square });
    if (move === null) {
      return Response.error("Invalid move");
    }
    state.turnCount++;
    state.moveablePiece = undefined;
    return Response.ok();
  }
  getUserState(state: InternalState, userId: UserId): PlayerState {
    const internalUser = state.users.find((u) => u.name === userId);
    return {
      board: state.chess.board().flatMap((pieces, i) => {
        return pieces.flatMap((piece, j) => (piece === null ? [] : convertPiece(piece, i, j)));
      }),
      status: gameStatus(state),
      color: internalUser?.color,
      opponent: internalUser !== undefined ?
                  state.users.filter((user : InternalUser) => { return user.color !== internalUser?.color }).flatMap(user => {return user.name}) : [],
      role: internalUser?.role,
      moveablePiece: state.moveablePiece,
   };
  }
}

function gameStatus(state: InternalState) {
  if (state.users.length < 4) {
    return GameStatus.WAITING;
  }
  if (state.chess.turn() === "w") {
    return state.moveablePiece === undefined ? GameStatus.WHITE_BRAIN_TURN : GameStatus.WHITE_HAND_TURN;
  }
  return state.moveablePiece === undefined ? GameStatus.BLACK_BRAIN_TURN : GameStatus.BLACK_HAND_TURN;
}

function convertPiece(piece: ChessPiece, i: number, j: number): Piece {
  const color = convertColor(piece.color);
  const type = convertType(piece.type);
  const square = ["a", "b", "c", "d", "e", "f", "g", "h"][j] + (8 - i);
  return {
    color,
    type,
    square,
  };
}
function convertColor(color: "w" | "b"): Color {
  switch (color) {
    case "w":
      return Color.WHITE;
    case "b":
      return Color.BLACK;
  }
}

function convertType(type: "p" | "n" | "b" | "r" | "q" | "k"): PieceType {
  switch (type) {
    case "p":
      return PieceType.PAWN;
    case "n":
      return PieceType.KNIGHT;
    case "b":
      return PieceType.BISHOP;
    case "r":
      return PieceType.ROOK;
    case "q":
      return PieceType.QUEEN;
    case "k":
      return PieceType.KING;
  }
}
function isUserInGame(userId : UserId, state: InternalState): Boolean {
  return state.users.find((u) => u.name === userId) !== undefined;
}

function isUserTurn(userId: UserId, state: InternalState): Boolean {
  const color = state.users.find((u) => u.name === userId)?.color;
  return convertColor(state.chess.turn()) === color;
}
function isPieceMoveable(pieceToMove: PieceType, state: InternalState): Boolean {
  const moves = state.chess.moves({ verbose:true});
  const colorTurn = state.chess.turn();
  for (let i = 0; i< moves.length; i++) {
    if (moves[i].color ===  colorTurn && convertType(moves[i].piece) === pieceToMove){
      return true;
    }
  }
  return false;
}
