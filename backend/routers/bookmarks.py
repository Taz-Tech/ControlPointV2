from fastapi import APIRouter, HTTPException, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from ..database import get_db
from ..models import UserBookmark

router = APIRouter(prefix="/api/bookmarks", tags=["bookmarks"])


class BookmarkBody(BaseModel):
    name: str
    url: str
    icon: str = "🔖"
    description: str = ""
    order_index: int = 0


def _user_id(request: Request) -> str:
    user = getattr(request.state, "user", None)
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user["id"]


@router.get("")
async def list_bookmarks(request: Request, db: AsyncSession = Depends(get_db)):
    uid = _user_id(request)
    result = await db.execute(
        select(UserBookmark)
        .where(UserBookmark.user_id == uid)
        .order_by(UserBookmark.order_index, UserBookmark.id)
    )
    rows = result.scalars().all()
    return [
        {"id": r.id, "name": r.name, "url": r.url, "icon": r.icon, "description": r.description, "order_index": r.order_index}
        for r in rows
    ]


@router.post("")
async def create_bookmark(request: Request, body: BookmarkBody, db: AsyncSession = Depends(get_db)):
    uid = _user_id(request)
    bookmark = UserBookmark(user_id=uid, **body.model_dump())
    db.add(bookmark)
    await db.commit()
    await db.refresh(bookmark)
    return {"id": bookmark.id, "name": bookmark.name, "url": bookmark.url, "icon": bookmark.icon, "description": bookmark.description, "order_index": bookmark.order_index}


@router.put("/{bookmark_id}")
async def update_bookmark(bookmark_id: int, request: Request, body: BookmarkBody, db: AsyncSession = Depends(get_db)):
    uid = _user_id(request)
    result = await db.execute(select(UserBookmark).where(UserBookmark.id == bookmark_id, UserBookmark.user_id == uid))
    bookmark = result.scalar_one_or_none()
    if not bookmark:
        raise HTTPException(status_code=404, detail="Bookmark not found")
    for k, v in body.model_dump().items():
        setattr(bookmark, k, v)
    await db.commit()
    return {"id": bookmark.id, "name": bookmark.name, "url": bookmark.url, "icon": bookmark.icon, "description": bookmark.description, "order_index": bookmark.order_index}


@router.delete("/{bookmark_id}")
async def delete_bookmark(bookmark_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    uid = _user_id(request)
    result = await db.execute(select(UserBookmark).where(UserBookmark.id == bookmark_id, UserBookmark.user_id == uid))
    bookmark = result.scalar_one_or_none()
    if not bookmark:
        raise HTTPException(status_code=404, detail="Bookmark not found")
    await db.delete(bookmark)
    await db.commit()
    return {"ok": True}
