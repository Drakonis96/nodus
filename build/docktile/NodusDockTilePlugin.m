#import <Cocoa/Cocoa.h>

@interface NodusDockTilePlugin : NSObject <NSDockTilePlugIn>
@property(nonatomic, strong) NSDockTile *dockTile;
@property(nonatomic, strong) NSImageView *imageView;
@property(nonatomic, strong) NSTimer *refreshTimer;
@property(nonatomic, strong) NSDate *lastModified;
@end

@implementation NodusDockTilePlugin

- (NSString *)persistedIconPath {
  return [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/Nodus/last-dock-icon.png"];
}

- (void)refreshIcon {
  NSString *iconPath = [self persistedIconPath];
  NSDictionary *attributes = [[NSFileManager defaultManager] attributesOfItemAtPath:iconPath error:nil];
  NSDate *modified = attributes[NSFileModificationDate];
  if (!modified || [modified isEqualToDate:self.lastModified]) return;

  NSImage *image = [[NSImage alloc] initWithContentsOfFile:iconPath];
  if (!image) return;
  self.lastModified = modified;
  self.imageView.image = image;
  [self.dockTile display];
}

- (void)setDockTile:(NSDockTile *)dockTile {
  [self.refreshTimer invalidate];
  self.refreshTimer = nil;
  self.dockTile = dockTile;
  if (!dockTile) {
    self.imageView = nil;
    return;
  }

  NSSize size = dockTile.size;
  self.imageView = [[NSImageView alloc] initWithFrame:NSMakeRect(0, 0, size.width, size.height)];
  self.imageView.imageScaling = NSImageScaleProportionallyUpOrDown;
  dockTile.contentView = self.imageView;
  dockTile.showsApplicationBadge = NO;
  self.lastModified = nil;
  [self refreshIcon];

  // The renderer updates the PNG whenever the vault or theme changes. The
  // plugin lives in the Dock process and watches that lightweight file so the
  // final image remains available after Nodus itself has exited.
  self.refreshTimer = [NSTimer timerWithTimeInterval:1.0
                                               target:self
                                             selector:@selector(refreshIcon)
                                             userInfo:nil
                                              repeats:YES];
  [[NSRunLoop mainRunLoop] addTimer:self.refreshTimer forMode:NSRunLoopCommonModes];
}

@end
